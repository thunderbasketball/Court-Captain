// Paying to register (SPEC.md section 14, Payments). When the League takes card payments (its Stripe account is
// connected and ready) and what's being registered costs something, the person is sent to Stripe Checkout on the
// League's own Stripe account; the teams are registered only once Stripe says it's paid. With nothing to pay, or no
// Stripe yet, it registers at once as before (paid outside the app). Every check runs on the server; amounts come from
// the program's own prices, never from the browser. Stripe itself is passed in (`deps.stripe`), so tests use a fake.
// One payment can cover several teams (the public Register form; Register ALL): one Checkout, a line per team.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "../auth/service";
import { copyOf, partnerFor, registerOrgTeam, teamRegistrar } from "../org-leagues";
import { leagueEntry, payLater, programRegStatus, saveChoice, type Entry } from "../scenic-programs";
import { withTx, type Queryable } from "../sql";
import type { StripeApi } from "./connect";
import { cardFee } from "./card-fee";

type Deps = { pool: Pool; stripe: StripeApi | null; now: () => Date };
const LEAGUE = "scenic-city";
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

export { CARD_CENTS, CARD_PERCENT, cardFee } from "./card-fee";

// Something to pay, and no card payments: nothing is registered (it waits in the cart).
export const NO_CARDS = "Card payments aren't available right now, so nothing was registered or added. It can wait in your cart.";

export type Payee = { account_id: string; fee_payer: "org" | "team"; live: boolean };

// The League's Stripe account, when it can take payments, and who pays the card fee.
export async function payee(q: Pick<Queryable, "query">, stripe: StripeApi | null): Promise<Payee | null> {
  if (!stripe) return null;
  const r = await q.query<{ account_id: string; fee_payer: "org" | "team" }>(
    "select account_id, fee_payer from org_stripe where org = $1 and livemode = $2 and charges_enabled",
    [LEAGUE, stripe.live],
  );
  return r.rows[0] ? { ...r.rows[0], live: stripe.live } : null;
}

// Runs fn in a transaction that's always undone: what registering would do, nothing kept.
export async function dryRun<T>(pool: Pool, fn: (q: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    c.release();
  }
}

// What a team owes for this registration (or addition): its price after, less its price before. Runs saveChoice, so
// call it where it's undone afterwards (a dry run, or inside a savepoint that's rolled back).
export async function owed(q: PoolClient, programId: string, teamId: string, choice: unknown, byName: string, now: Date) {
  const p = await q.query<{ kind: string; fee_cents: number | null }>("select kind, fee_cents from scenic_programs where id = $1", [programId]);
  const kind = p.rows[0]?.kind;
  const before = (await leagueEntry(q, programId, teamId)).entry;
  const had = (await q.query("select 1 from scenic_registrations where program_id = $1 and team_id = $2", [programId, teamId])).rowCount;
  const placed = await saveChoice(q, programId, teamId, choice, byName, now);
  if ("error" in placed) return placed;
  if (kind !== "League") return { cents: had ? 0 : (p.rows[0]?.fee_cents ?? 0) };
  return { cents: Math.max(0, (placed.entry?.feeCents ?? 0) - (before?.feeCents ?? 0)) };
}

export type PayTeam = { teamId: string; orgTeamId: string | null; choice: unknown; cents: number };

// Records a payment waiting on Stripe (its teams and what each costs); the Checkout is opened after (openCheckout), once
// the caller's transaction is in. `teamOrg`: the teams' organization (for the way back).
export async function insertPayment(
  q: Pick<Queryable, "query">,
  to: Payee,
  p: { programId: string; teamOrg: string; teams: PayTeam[]; startedBy: string; now: Date },
): Promise<string> {
  const total = p.teams.reduce((s, t) => s + t.cents, 0);
  const one = p.teams.length === 1 ? p.teams[0] : null;
  const card = to.fee_payer === "team" ? cardFee(total) : 0;
  const r = await q.query<{ id: string }>(
    `insert into registration_payments (org, livemode, account_id, program_id, team_id, team_org, org_team_id, choice, fee_cents,
                                        card_fee_cents, started_by, started_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id::text`,
    [LEAGUE, to.live, to.account_id, p.programId, one?.teamId ?? null, p.teamOrg, one?.orgTeamId ?? null,
     one && one.choice !== undefined ? JSON.stringify(one.choice) : null, total, card, p.startedBy, p.now],
  );
  const id = r.rows[0].id;
  for (const t of p.teams)
    await q.query(
      `insert into registration_payment_teams (payment_id, team_id, org_team_id, choice, fee_cents, team_name)
       values ($1, $2, $3, $4, $5, (select name from scenic_teams where id = $2))`,
      [id, t.teamId, t.orgTeamId, t.choice === undefined ? null : JSON.stringify(t.choice), t.cents],
    );
  return id;
}

// Opens Stripe Checkout for a recorded payment: a line per team that costs something ("Program: Team"), plus Card
// processing when the team pays it. `base`: this site's address; `cancelPage`: where Back on Stripe's page goes.
export async function openCheckout(deps: Deps, paymentId: string, base: string, cancelPage: string): Promise<string> {
  return (await startCheckout(deps, paymentId, base, cancelPage, false)).url;
}

// The same payment, paid in our page: Stripe's form opens under the summary (its client secret and the League's Stripe
// account, which the form needs). Cancel just closes it: nothing is added, the payment stays unfinished.
export type InPage = { clientSecret: string; account: string };
export async function openCheckoutInPage(deps: Deps, paymentId: string, base: string): Promise<InPage> {
  const c = await startCheckout(deps, paymentId, base, "", true);
  return { clientSecret: c.clientSecret!, account: c.account };
}

async function startCheckout(deps: Deps, paymentId: string, base: string, cancelPage: string, embedded: boolean) {
  const stripe = deps.stripe;
  if (!stripe) throw new Error("Stripe isn't set up");
  const pay = (
    await deps.pool.query<{ account_id: string; card_fee_cents: number; program: string }>(
      `select r.account_id, r.card_fee_cents, p.name as program from registration_payments r
         join scenic_programs p on p.id = r.program_id where r.id = $1`,
      [paymentId],
    )
  ).rows[0];
  const teams = await deps.pool.query<{ name: string; fee_cents: number }>(
    `select coalesce(x.team_name, 'Team') as name, x.fee_cents from registration_payment_teams x
      where x.payment_id = $1 and x.fee_cents > 0 order by lower(x.team_name), x.id`,
    [paymentId],
  );
  const checkout = await stripe.createCheckout({
    account: pay.account_id,
    lines: [
      ...teams.rows.map((t) => ({ name: `${pay.program}: ${t.name}`, cents: t.fee_cents })),
      ...(pay.card_fee_cents ? [{ name: "Card processing", cents: pay.card_fee_cents }] : []),
    ],
    successUrl: `${base}/stripe/paid?p=${paymentId}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}${cancelPage}`,
    ref: paymentId,
    embedded,
  });
  await deps.pool.query("update registration_payments set session_id = $2 where id = $1", [paymentId, checkout.id]);
  return { url: checkout.url, clientSecret: checkout.clientSecret, account: pay.account_id };
}

export type RegisterResult =
  | { ok: true; pay: string; division?: undefined; entry?: undefined; choose?: undefined; payInPage?: undefined } // off to Stripe Checkout
  | { ok: true; payInPage: InPage; pay?: undefined; division?: undefined; entry?: undefined; choose?: undefined } // Stripe's form in the page
  // Pay later organization: asked first, pay now by card or later (what it costs, and the card fee added for the team).
  | { ok: true; choose: { cents: number; card: number }; pay?: undefined; division?: undefined; entry?: undefined; payInPage?: undefined }
  | { ok: true; division: string | null; entry: Entry | null; pay?: undefined; choose?: undefined; payInPage?: undefined } // registered (nothing to pay by card)
  | { ok: false; message: string };

// Register (or Add dates) from the team's page: to Stripe Checkout when there's something to pay by card, else as before.
// `base`: this site's address, for Stripe's way back. A Pay later organization (its price group) is asked first
// (`choose`): `mode` "card" pays now by card; "later" registers now, unpaid (its invoice says PAY LATER).
export async function registerOrPay(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  orgTeamId: unknown,
  programId: unknown,
  choice: unknown,
  base: string,
  mode?: unknown,
  inPage = false, // Stripe's form opens in the page (the site has Stripe's publishable key)
): Promise<RegisterResult> {
  if (!isId(orgTeamId) || !isId(programId)) return { ok: false, message: "Pick a team and a program." };
  // The organization's Admins and Directors of Teams, or the team's coach adding to its registration (checked again there).
  const who = await teamRegistrar(deps.pool, viewer, org, orgTeamId);
  if (!who) return { ok: false, message: "Only an Admin, a Director of Teams or the team's coach can register teams." };
  const o = who.org;
  if (!who.manager) {
    const had = await deps.pool.query(
      `select 1 from scenic_teams st join scenic_registrations r on r.team_id = st.id
        where st.org_team_id = $1 and r.program_id = $2 and r.removed_at is null`,
      [orgTeamId, programId],
    );
    if (!had.rowCount) return { ok: false, message: "Your Director registers the team first; then you can add dates." };
  }
  const later = await payLater(deps.pool, programId, o);
  if (later && mode === "later") return registerOrgTeam(deps, viewer, o, orgTeamId, programId, choice); // pay later
  const to = await payee(deps.pool, deps.stripe);
  if (!to || !deps.stripe) {
    if (later) return registerOrgTeam(deps, viewer, o, orgTeamId, programId, choice); // Pay later: added now, on its invoice
  }

  // The team's copy in the League (kept: it's made on registering anyway), then what this would cost, nothing kept.
  const team = await withTx(deps.pool, async (q) => {
    const t = await q.query("select 1 from org_teams where id = $1 and org = $2 and archived_at is null", [orgTeamId, o]);
    if (!t.rowCount) return null;
    return copyOf(q, orgTeamId, await partnerFor(q, o, by(viewer)), by(viewer), deps.now());
  });
  if (!team) return { ok: false, message: "That team no longer exists (or is archived)." };
  const check = await dryRun(deps.pool, async (q) => {
    const status = await programRegStatus(q, programId, deps.now());
    if (!status) return { error: "That program no longer exists." };
    if (status !== "open") return { error: "Registration isn't open for this program." };
    return owed(q, programId, team, choice, by(viewer), deps.now());
  });
  if ("error" in check) return { ok: false, message: check.error };
  if (!check.cents) return registerOrgTeam(deps, viewer, o, orgTeamId, programId, choice);
  // Something to pay and no card payments: nothing is registered unpaid (without Pay later it waits in the cart).
  if (!to || !deps.stripe) return { ok: false, message: NO_CARDS };
  // Pay later organization, not yet asked: pay now by card, or later?
  if (later && mode !== "card") return { ok: true, choose: { cents: check.cents, card: to.fee_payer === "team" ? cardFee(check.cents) : 0 } };

  const id = await insertPayment(deps.pool, to, {
    programId,
    teamOrg: o,
    teams: [{ teamId: team, orgTeamId, choice, cents: check.cents }],
    startedBy: by(viewer),
    now: deps.now(),
  });
  if (inPage) return { ok: true, payInPage: await openCheckoutInPage(deps, id, base) };
  const page = `/org/${encodeURIComponent(o)}/teams/${orgTeamId}`;
  return { ok: true, pay: await openCheckout(deps, id, base, `${page}?paid=cancelled&tab=register`) };
}

export type ConfirmResult =
  // `paidNow`: it went through on this call (so its invoice is emailed once): the program and the teams' organization.
  | { ok: true; registered: boolean; teamPage: string | null; message: string; paidNow?: { programId: string; org: string } }
  | { ok: false; message: string; teamPage: string | null };

// Back from Stripe (or Stripe's own notice): asks Stripe whether it's paid, and if so registers its teams as each picked
// (once, however many times this runs; all of them or none). If registering can't go through now (say a division was
// removed), the payment is kept as failed with why, for Scenic City's Owners to refund.
export async function confirmPayment(deps: Deps, paymentId: unknown, sessionId: unknown): Promise<ConfirmResult> {
  if (!isId(paymentId) || typeof sessionId !== "string") return { ok: false, message: "That payment wasn't found.", teamPage: null };
  const stripe = deps.stripe;
  return withTx(deps.pool, async (q) => {
    const r = await q.query<{
      account_id: string;
      program_id: string;
      team_id: string | null;
      team_org: string | null;
      org_team_id: string | null;
      choice: unknown;
      status: string;
      started_by: string;
      error: string | null;
      kind: "register" | "invoice";
    }>(
      `select account_id, program_id::text, team_id::text, team_org, org_team_id::text, choice, status, started_by, error, kind
         from registration_payments where id = $1 and session_id = $2 for update`,
      [paymentId, sessionId],
    );
    const p = r.rows[0];
    if (!p) return { ok: false as const, message: "That payment wasn't found.", teamPage: null };
    const listed = await q.query<{ team_id: string | null; org_team_id: string | null; choice: unknown; team_name: string | null; fee_cents: number }>(
      "select team_id::text, org_team_id::text, choice, team_name, fee_cents from registration_payment_teams where payment_id = $1 order by id",
      [paymentId],
    );
    const teams = listed.rows.length ? listed.rows : p.team_id ? [{ team_id: p.team_id, org_team_id: p.org_team_id, choice: p.choice }] : [];
    const org = p.team_org ? encodeURIComponent(p.team_org) : null;
    // One team: its page; several: the organization's Teams.
    // A League team kept by Scenic City (Solo, a club, FastBreak; dates added on its League team page): its page.
    const league = p.team_org === LEAGUE;
    const teamPage = !org
      ? null
      : p.kind === "invoice"
        ? `/invoice/${org}/${p.program_id}` // back to the invoice it paid
        : league && teams.length === 1 && teams[0].team_id
          ? `/org/${LEAGUE}/teams/${teams[0].team_id}`
          : teams.length === 1 && teams[0].org_team_id
            ? `/org/${org}/teams/${teams[0].org_team_id}`
            : `/org/${org}?open=teams`;
    if (p.status === "registered") return { ok: true as const, registered: true, teamPage, message: "Paid and registered." };
    if (p.status === "failed") return { ok: false as const, message: `Paid, but not registered: ${p.error}`, teamPage };
    if (!stripe) return { ok: false as const, message: "Online payments aren't set up on CourtCaptain.", teamPage };
    if (!(await stripe.checkoutPaid({ account: p.account_id, id: sessionId })))
      return { ok: true as const, registered: false, teamPage, message: "The payment isn't finished, so the team isn't registered yet." };
    const now = deps.now();
    if (p.kind === "invoice") {
      // An open invoice paid: its teams still registered are marked Paid by card.
      const ids = teams.flatMap((t) => (t.team_id ? [t.team_id] : []));
      const done = await q.query(
        `update scenic_registrations set paid = true, paid_set_by = 'Card (Stripe)', paid_set_at = $3, paid_cents = null
          where program_id = $1 and team_id = any($2::bigint[])`,
        [p.program_id, ids, now],
      );
      if (!done.rowCount) {
        const why = "Its teams are no longer registered.";
        await q.query("update registration_payments set status = 'failed', error = $2 where id = $1", [paymentId, why]);
        return { ok: false as const, message: `Paid, but ${why.toLowerCase()} Scenic City will refund it.`, teamPage };
      }
      await q.query("update registration_payments set status = 'registered', registered_at = $2 where id = $1", [paymentId, now]);
      return {
        ok: true as const,
        registered: true,
        teamPage,
        message: "Paid: the invoice is updated.",
        ...(p.team_org ? { paidNow: { programId: p.program_id, org: p.team_org } } : {}),
      };
    }
    await q.query("savepoint reg");
    let division: string | null = null;
    for (const t of teams) {
      if (!t.team_id) {
        // Its team was deleted before the payment came through: kept as failed, for a refund.
        await q.query("rollback to savepoint reg");
        const why = `${("team_name" in t && t.team_name) || "A team"} was deleted.`;
        await q.query("update registration_payments set status = 'failed', error = $2 where id = $1", [paymentId, why]);
        return { ok: false as const, message: `Paid, but not registered: ${why} Scenic City will refund it.`, teamPage };
      }
      const had = (await q.query("select 1 from scenic_registrations where program_id = $1 and team_id = $2", [p.program_id, t.team_id])).rowCount;
      // Paid while registration was open: each option's own close doesn't stop it now.
      const placed = await saveChoice(q, p.program_id, t.team_id, t.choice ?? undefined, p.started_by, now, false);
      if ("error" in placed) {
        await q.query("rollback to savepoint reg");
        const why = teams.length > 1 ? `${await teamName(q, t.team_id)}: ${placed.error}` : placed.error;
        await q.query("update registration_payments set status = 'failed', error = $2 where id = $1", [paymentId, why]);
        return { ok: false as const, message: `Paid, but not registered: ${why} Scenic City will refund it.`, teamPage };
      }
      division = placed.division;
      // Added by card to a registration not paid yet (Pay later): that much of its fee is paid.
      if (had && "fee_cents" in t)
        await q.query("update scenic_registrations set paid_cents = coalesce(paid_cents, 0) + $3 where program_id = $1 and team_id = $2 and not paid", [
          p.program_id,
          t.team_id,
          t.fee_cents,
        ]);
      if (!had)
        await q.query(
          "update scenic_registrations set paid = true, paid_set_by = 'Card (Stripe)', paid_set_at = $3 where program_id = $1 and team_id = $2",
          [p.program_id, t.team_id, now],
        );
    }
    await q.query("update registration_payments set status = 'registered', registered_at = $2 where id = $1", [paymentId, now]);
    // Paid from a cart (or an invoice requested from one): its items leave it, and the invoice is paid.
    await q.query(
      `update cart_invoices i set paid_by = 'Card (Stripe)', paid_at = $2, cancelled_by = null, cancelled_at = null
         from registration_payments r where r.id = $1 and i.id = r.cart_invoice_id`,
      [paymentId, now],
    );
    await q.query("delete from cart_items c using registration_payments r where r.id = $1 and c.id = any(r.cart_items)", [paymentId]);
    return {
      ok: true as const,
      registered: true,
      teamPage,
      ...(p.team_org && !league ? { paidNow: { programId: p.program_id, org: p.team_org } } : {}), // its organization's invoice
      message:
        teams.length > 1
          ? `Paid and registered ${teams.length} teams.`
          : division
            ? `Paid and registered: ${division}.`
            : "Paid: registration updated.",
    };
  });
}

const teamName = async (q: Pick<Queryable, "query">, id: string) =>
  (await q.query<{ name: string }>("select name from scenic_teams where id = $1", [id])).rows[0]?.name ?? "A team";
