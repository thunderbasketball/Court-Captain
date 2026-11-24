// Invoices requested from a cart (SPEC.md section 14, Payments): a person asks for an invoice for one organization's teams in
// one program instead of paying by card now. It's emailed to them and the organization's Owners, shows as PENDING to the
// League, and can be paid later by card from its page (by them or whoever manages the organization's teams), or marked paid
// by the League's Owners (a check). Nothing is registered, or marked paid, until then; then its teams register together, paid.
// Due the day before its first event: not paid by then, it's closed. Its prices are the League's own, checked again when paid.
// Cancelling puts its items back in the cart. (A Pay later organization doesn't need one: its Pay later registers now.)
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { Stop, findTeam, payItems, payLaterDue, priced, standing, tidy, type ClaimRow, type PayCartResult } from "./cart";
import { isOrgOwner } from "./org-admin";
import { copyOf, partnerFor } from "./org-leagues";
import { orgName } from "./org-registry";
import { canManageTeams } from "./org-teams";
import { payLater, programRegStatus } from "./scenic-programs";
import { withTx, type Queryable } from "./sql";
import type { StripeApi } from "./stripe/connect";
import { owed, payee } from "./stripe/registration";
import { cardFee } from "./stripe/card-fee";

type Deps = { pool: Pool; now: () => Date };
type PayDeps = Deps & { stripe: StripeApi | null };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const LEAGUE = "scenic-city";
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const longDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

type Head = {
  id: string;
  program_id: string;
  program: string;
  team_org: string;
  coach_id: string;
  first: string;
  last: string;
  requested_name: string;
  requested_at: Date;
  due_on: string;
  paid_by: string | null;
  paid_at: Date | null;
  cancelled_by: string | null;
};
const HEAD = `select i.id::text, i.program_id::text, p.name as program, i.team_org, i.coach_id, u.first_name as first, u.last_name as last, i.requested_name,
    i.requested_at, i.due_on::text, i.paid_by, i.paid_at, i.cancelled_by
  from cart_invoices i join scenic_programs p on p.id = i.program_id join users u on u.coach_id = i.coach_id`;

// Ask for an invoice for what's in the cart for one organization and program (all of it). Returns its number.
export async function requestInvoice(deps: Deps, viewer: SessionUser, org: unknown, programId: unknown): Promise<Result<{ id: string }>> {
  if (!isId(programId) || typeof org !== "string" || !org) return { ok: false, message: "That isn't in your cart." };
  try {
    const r = await withTx(deps.pool, async (q) => {
      const before = (await q.query<{ n: number }>("select count(*)::int as n from cart_items where coach_id = $1 and removed_at is null", [viewer.coachId])).rows[0].n;
      const all = await tidy(q, deps.now(), viewer);
      if (all.length !== before) return null; // something came out: kept, and shown first
      const items = all.filter((x) => x.row.team_org === org && x.row.program_id === programId && !x.row.invoice_id);
      if (!items.length) throw new Stop("Nothing is in your cart for that.");
      if (await payLater(q, programId, org)) throw new Stop("Your organization can Pay later: that registers the teams now and emails the invoice.");
      let cents = 0;
      const dues: string[] = [];
      for (const x of items) {
        const p = await priced(q, deps.now(), { programId, choice: x.row.choice, team: x.team, registered: x.registered });
        if (p.problem) throw new Stop(`${x.team.name}: ${p.problem}`);
        cents += p.cents;
        dues.push(await payLaterDue(q, deps.now(), programId, x.row.choice));
      }
      if (!cents) throw new Stop("There's nothing to pay: tap Register instead.");
      const due = dues.sort()[0];
      if (due < new Date(deps.now()).toLocaleDateString("en-CA", { timeZone: "America/New_York" }))
        throw new Stop("It's too close to the event for an invoice: pay by card.");
      const ins = await q.query<{ id: string }>(
        `insert into cart_invoices (program_id, team_org, coach_id, requested_name, requested_at, due_on) values ($1, $2, $3, $4, $5, $6) returning id::text`,
        [programId, org, viewer.coachId, by(viewer), deps.now(), due],
      );
      await q.query("update cart_items set invoice_id = $2 where id = any($1::bigint[])", [items.map((x) => x.row.id), ins.rows[0].id]);
      return ins.rows[0].id;
    });
    return r ? { ok: true, id: r } : { ok: false, message: "Your cart changed (a team was registered or is gone). Check it and try again." };
  } catch (e) {
    if (e instanceof Stop) return { ok: false, message: e.message };
    throw e;
  }
}

export type RequestedInvoice = {
  id: string;
  org: string;
  orgName: string;
  from: string;
  programId: string;
  program: string;
  requestedBy: string;
  requestedAt: Date;
  due: string;
  state: "PENDING" | "PAID" | "CLOSED"; // closed: cancelled, or not paid by its due date
  paidBy: string | null;
  lines: { team: string; level: string; what: string; adding: boolean; cents: number; problem: string | null }[]; // while PENDING
  cents: number;
  cardCents: number; // the card fee added for the team when paid by card
  canPay: boolean; // by card
  canMarkPaid: boolean; // the League's Owners
  canCancel: boolean;
};

async function may(q: Pick<Queryable, "query">, viewer: SessionUser, h: Head) {
  const [league, manages] = await Promise.all([isOrgOwner(q, viewer.coachId, LEAGUE), h.coach_id === viewer.coachId ? true : canManageTeams(q, viewer, h.team_org)]);
  return { see: league || manages, pay: manages, league };
}

async function build(q: Pick<Queryable, "query">, stripe: StripeApi | null, viewer: SessionUser, now: Date, h: Head): Promise<RequestedInvoice | null> {
  const m = await may(q, viewer, h);
  if (!m.see) return null;
  const lines: RequestedInvoice["lines"] = [];
  if (!h.paid_at && !h.cancelled_by) {
    const r = await q.query<ClaimRow & { org_team_id: string | null; team_id: string | null }>(
      `select c.coach_id, u.first_name as first, u.last_name as last, c.program_id::text, c.org_team_id::text, c.team_id::text, c.choice, c.adding, c.added_at,
              c.invoice_id::text, i.due_on::text
         from cart_items c join cart_invoices i on i.id = c.invoice_id join users u on u.coach_id = c.coach_id
        where c.invoice_id = $1 and c.removed_at is null order by c.id`,
      [h.id],
    );
    for (const c of r.rows) {
      const team = await findTeam(q, { orgTeamId: c.org_team_id, teamId: c.team_id });
      const s = team && (await standing(q, now, c, team));
      if (!team || !s) continue;
      const p = await priced(q, now, { programId: h.program_id, choice: s.choice, team, registered: s.registered });
      lines.push({ team: team.name, level: team.level, what: p.what, adding: s.registered, cents: p.cents, problem: p.problem });
    }
    lines.sort((a, b) => a.team.localeCompare(b.team, undefined, { numeric: true }));
  }
  const state = h.paid_at ? "PAID" : lines.length ? "PENDING" : "CLOSED";
  const cents = lines.reduce((n, l) => n + (l.problem ? 0 : l.cents), 0);
  const to = state === "PENDING" && m.pay ? await payee(q, stripe) : null;
  return {
    id: h.id,
    org: h.team_org,
    orgName: await orgName(q, h.team_org),
    from: await orgName(q, LEAGUE),
    programId: h.program_id,
    program: h.program,
    requestedBy: h.requested_name,
    requestedAt: h.requested_at,
    due: h.due_on,
    state,
    paidBy: h.paid_by,
    lines,
    cents,
    cardCents: to?.fee_payer === "team" ? cardFee(cents) : 0,
    canPay: !!to && !lines.some((l) => l.problem),
    canMarkPaid: m.league && state === "PENDING",
    canCancel: state === "PENDING",
  };
}

// One requested invoice: whoever requested it, whoever manages the organization's teams, and the League's Owners.
export async function requestedInvoice(deps: PayDeps, viewer: SessionUser, id: unknown): Promise<RequestedInvoice | null> {
  if (!isId(id)) return null;
  const h = (await deps.pool.query<Head>(`${HEAD} where i.id = $1`, [id])).rows[0];
  return h ? build(deps.pool, deps.stripe, viewer, deps.now(), h) : null;
}

// Invoices waiting to be paid: an organization's (its Home and team pages), or a program's (the League's Owners).
export async function pendingInvoices(deps: PayDeps, viewer: SessionUser, of: { org: string } | { programId: string }): Promise<RequestedInvoice[]> {
  const program = "programId" in of;
  if (program && !(await isOrgOwner(deps.pool, viewer.coachId, LEAGUE))) return [];
  const r = await deps.pool.query<Head>(
    `${HEAD} where i.paid_at is null and i.cancelled_at is null and ${program ? "i.program_id = $1" : "i.team_org = $1"} order by i.due_on, i.id`,
    [program ? of.programId : of.org],
  );
  const all = await Promise.all(r.rows.map((h) => build(deps.pool, deps.stripe, viewer, deps.now(), h)));
  return all.filter((i) => !!i).filter((i) => i.state === "PENDING");
}

const head = async (q: Pick<Queryable, "query">, id: string) => (await q.query<Head>(`${HEAD} where i.id = $1 and i.paid_at is null and i.cancelled_at is null`, [id])).rows[0];
const ownerOf = (h: Head) => ({ coachId: h.coach_id, firstName: h.first, lastName: h.last }) as SessionUser; // rights are read by their id

// Pay it by card: one payment, its teams registered once Stripe says it's paid.
export async function payRequested(deps: PayDeps, viewer: SessionUser, id: unknown, base: string, inPage = false): Promise<PayCartResult> {
  const h = isId(id) ? await head(deps.pool, id) : undefined;
  if (!h || !(await may(deps.pool, viewer, h)).pay) return { ok: false, message: "That invoice isn't there to pay." };
  return payItems(deps, viewer, ownerOf(h), { org: h.team_org, programId: h.program_id, invoiceId: h.id }, base, "card", inPage, `/invoice/request/${h.id}?paid=cancelled`);
}

// The League's Owners mark it paid (a check): its teams register now, paid. Who did it is recorded.
export async function markRequestedPaid(deps: Deps, viewer: SessionUser, id: unknown): Promise<Result<{ programId: string; org: string; registered: number }>> {
  if (!isId(id)) return { ok: false, message: "That invoice isn't there." };
  if (!(await isOrgOwner(deps.pool, viewer.coachId, LEAGUE))) return { ok: false, message: "Only the League's Owners can mark an invoice paid." };
  try {
    const r = await withTx(deps.pool, async (q) => {
      const h = await head(q, id);
      if (!h) throw new Stop("That invoice was already paid or closed.");
      const before = (await q.query<{ n: number }>("select count(*)::int as n from cart_items where invoice_id = $1 and removed_at is null", [id])).rows[0].n;
      const items = (await tidy(q, deps.now(), ownerOf(h))).filter((x) => x.row.invoice_id === id);
      if (items.length !== before) return null; // a team came off it: kept, and shown first
      const status = await programRegStatus(q, h.program_id, deps.now());
      if (!status) throw new Stop("That program no longer exists.");
      const who = by(viewer);
      for (const x of items) {
        if (!x.registered && status !== "open") throw new Stop(`${x.team.name}: registration isn't open.`);
        const p = await priced(q, deps.now(), { programId: h.program_id, choice: x.row.choice, team: x.team, registered: x.registered });
        if (p.problem) throw new Stop(`${x.team.name}: ${p.problem}`);
        const teamId = x.team.orgTeamId ? await copyOf(q, x.team.orgTeamId, await partnerFor(q, x.team.org as never, who), who, deps.now()) : x.team.teamId!;
        const cost = await owed(q, h.program_id, teamId, x.row.choice ?? undefined, who, deps.now()); // registers it
        if ("error" in cost) throw new Stop(`${x.team.name}: ${cost.error}`);
        if (x.registered)
          // More for a team already in: a paid one stays paid; one that still owes has this much of its fee paid.
          await q.query("update scenic_registrations set paid_cents = coalesce(paid_cents, 0) + $3 where program_id = $1 and team_id = $2 and not paid", [h.program_id, teamId, cost.cents]);
        else
          await q.query("update scenic_registrations set paid = true, paid_set_by = $3, paid_set_at = $4 where program_id = $1 and team_id = $2", [
            h.program_id,
            teamId,
            `${who} (invoice #${id})`,
            deps.now(),
          ]);
      }
      await q.query("delete from cart_items where id = any($1::bigint[])", [items.map((x) => x.row.id)]);
      await q.query("update cart_invoices set paid_by = $2, paid_at = $3 where id = $1", [id, who, deps.now()]);
      return { programId: h.program_id, org: h.team_org, registered: items.length };
    });
    return r ? { ok: true, ...r } : { ok: false, message: "The invoice changed (a team was registered or is gone). Check it and try again." };
  } catch (e) {
    if (e instanceof Stop) return { ok: false, message: e.message };
    throw e;
  }
}

// Cancel it: its items go back in that person's cart (7 more days). Whoever requested it or manages the teams, or the
// League's Owners.
export async function cancelRequested(deps: Deps, viewer: SessionUser, id: unknown): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That invoice isn't there." };
  return withTx(deps.pool, async (q) => {
    const h = await head(q, id);
    if (!h || !(await may(q, viewer, h)).see) return { ok: false as const, message: "That invoice was already paid or closed." };
    await q.query("select pg_advisory_xact_lock(hashtext('cart:' || $1))", [h.coach_id]);
    // (Picked again meanwhile for the same team: that one stays, this comes off.)
    await q.query(
      `delete from cart_items x where x.invoice_id = $1 and exists (select 1 from cart_items c where c.coach_id = x.coach_id and c.program_id = x.program_id
         and c.invoice_id is null and c.removed_at is null and (c.org_team_id = x.org_team_id or c.team_id = x.team_id))`,
      [id],
    );
    await q.query("update cart_items set invoice_id = null, added_at = $2 where invoice_id = $1 and removed_at is null", [id, deps.now()]);
    await q.query("update cart_invoices set cancelled_by = $2, cancelled_at = $3 where id = $1", [id, by(viewer), deps.now()]);
    return { ok: true as const };
  });
}

// The invoice as an email: to whoever requested it and the organization's Owners (none of the League's own "Solo" teams').
export async function requestedInvoiceEmail(deps: PayDeps, viewer: SessionUser, id: string, appUrl: string) {
  const inv = await requestedInvoice(deps, viewer, id);
  if (!inv || inv.state !== "PENDING") return null;
  const to = await deps.pool.query<{ email: string }>(
    `select distinct lower(coalesce(u.verified_email, u.email)) as email from users u
      where u.active and coalesce(u.verified_email, u.email) is not null
        and (u.coach_id = $1 or ($2 <> '${LEAGUE}' and exists (select 1 from org_roles r where r.org = $2 and r.role = 'Owner' and r.coach_id = u.coach_id)))`,
    [viewer.coachId, inv.org],
  );
  const text = [
    `Invoice #${inv.id} from ${inv.from}`,
    `${inv.orgName} · ${inv.program}`,
    "Status: PENDING (not registered until it's paid)",
    `Pay by: ${longDay(inv.due)}`,
    "",
    ...inv.lines.map((l) => `${l.team}\n  ${l.adding ? "Adding: " : ""}${l.what}: ${money(l.cents)}`),
    "",
    `Total due: ${money(inv.cents)}`,
    ...(inv.cardCents ? [`Paid by card: ${money(inv.cents + inv.cardCents)} (with card processing)`] : []),
    "",
    `View, print and pay it: ${appUrl.replace(/\/+$/, "")}/invoice/request/${inv.id}`,
    "",
    "The teams register when it's paid. Not paid by the date above, it's closed and nothing is registered.",
  ].join("\n");
  return { to: to.rows.map((r) => r.email), subject: `${inv.from} invoice #${inv.id}: ${inv.program} · PENDING · pay by ${longDay(inv.due)}`, text };
}
