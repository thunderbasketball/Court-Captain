// The shopping cart (SPEC.md section 14, Payments): a person picks what each team registers for, in any format (ALL Season,
// single dates, a 2nd Game), puts them in their cart, and pays for them together. Their own cart, grouped by organization
// and program: one card payment per group (like its invoice). A team is registered only once it's paid (a Pay later
// organization may register now and owe it). An item comes out by itself when someone else registers that team first (or
// adds those dates), the team is gone, or the person may no longer register it; they're told why. One cart at a time: what's
// in one person's cart can't go in another's (the team's page says whose it's in); paying now still may. Not paid for in 7
// days, it comes out. The League's Owners see what's in everyone's carts for a program, and may register one now to be paid
// later (due the day before its first event), case by case. Rights, rules and prices
// are checked on the server when the cart is shown and again when it's paid; nothing is taken from the browser.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { mayNotAddDates } from "./league-dates";
import { copyOf, partnerFor, teamRegistrar } from "./org-leagues";
import { isOrgOwner } from "./org-admin";
import { orgName } from "./org-registry";
import { cleanChoice, closedReason, entryLine, pickedLine, planChoice, type Choice } from "./program-options";
import { leagueEntry, owesMore, payLater, programRegStatus } from "./scenic-programs";
import { withTx, type Queryable } from "./sql";
import { cardFee } from "./stripe/card-fee";
import type { StripeApi } from "./stripe/connect";
import { NO_CARDS, insertPayment, openCheckout, openCheckoutInPage, owed, payee, type InPage, type PayTeam } from "./stripe/registration";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type PayDeps = Deps & { stripe: StripeApi | null };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const MAX_ITEMS = 200;
// What isn't paid for in this many days comes out by itself.
export const CART_DAYS = 7;
const DAY = 86_400_000;
const expired = (added: Date, now: Date) => added.getTime() + CART_DAYS * DAY <= now.getTime();

// The team being registered: an organization's own team (its team page), or a League team (its League page; Thunder's).
export type CartTeam = { org: string; orgTeamId: string } | { teamId: string };

type Found = {
  org: string; // whose team it is
  orgTeamId: string | null;
  teamId: string | null; // its League team (null: an organization's team not in the League yet)
  name: string;
  level: string;
};

export async function findTeam(q: Pick<Queryable, "query">, t: { orgTeamId?: unknown; teamId?: unknown }): Promise<Found | null> {
  if (isId(t.orgTeamId)) {
    const r = await q.query<Found>(
      `select t.org, t.id::text as "orgTeamId", st.id::text as "teamId", t.name, t.level
         from org_teams t left join scenic_teams st on st.org_team_id = t.id where t.id = $1 and t.archived_at is null`,
      [t.orgTeamId],
    );
    return r.rows[0] ?? null;
  }
  if (!isId(t.teamId)) return null;
  const r = await q.query<Found>(
    `select coalesce(ot.org, case when st.thunder_team_id is not null then 'thunder' else 'scenic-city' end) as org,
            st.org_team_id::text as "orgTeamId", st.id::text as "teamId", st.name, st.level
       from scenic_teams st left join org_teams ot on ot.id = st.org_team_id where st.id = $1 and ot.archived_at is null`,
    [t.teamId],
  );
  return r.rows[0] ?? null;
}

// The team's registration in a program (null: not registered), and who made it.
const registration = async (q: Pick<Queryable, "query">, programId: string, teamId: string | null) =>
  teamId
    ? ((
        await q.query<{ by: string; out: boolean }>(
          `select registered_by as by, removed_at is not null as out from scenic_registrations where program_id = $1 and team_id = $2`,
          [programId, teamId],
        )
      ).rows[0] ?? null)
    : null;

// Why this person may not put this in the cart or pay for it (null: they may). First registration: whoever manages the
// organization's teams. Adding to one: those, its coaches (a COMP team's) and the League's directors.
async function mayNot(q: Pick<Queryable, "query">, viewer: SessionUser, t: Found, registered: boolean): Promise<string | null> {
  const who = t.orgTeamId ? await teamRegistrar(q, viewer, t.org, t.orgTeamId) : null;
  if (who?.manager) return null;
  if (!registered)
    return t.orgTeamId ? "Only an Admin or a Director of Teams registers the team first; then its coach can add dates." : "Register the team first; then dates can be added.";
  if (who) return null;
  return t.teamId ? mayNotAddDates(q, viewer, t.teamId) : "Only the team's coaches and its directors can add dates.";
}

// Put a team's registration (or more dates for one) in the person's cart; picked again, it replaces what was there.
export async function addToCart(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  team: { org?: unknown; orgTeamId?: unknown; teamId?: unknown },
  choice: unknown,
): Promise<Result<{ replaced: boolean }>> {
  if (!isId(programId)) return { ok: false, message: "Pick a program." };
  const picked = choice === undefined || choice === null ? null : cleanChoice(choice);
  if (choice !== undefined && choice !== null && !picked) return { ok: false, message: "Those picks weren't readable. Refresh and try again." };
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('cart:' || $1))", [viewer.coachId]); // one change to a cart at a time
    const t = await findTeam(q, team);
    if (!t) return { ok: false as const, message: "That team no longer exists (or is archived)." };
    const reg = await registration(q, programId, t.teamId);
    if (reg?.out) return { ok: false as const, message: "The League took this team out: ask its directors." };
    const no = await mayNot(q, viewer, t, !!reg);
    if (no) return { ok: false as const, message: no };
    const p = await priced(q, deps.now(), { programId, choice: picked, team: t, registered: !!reg });
    if (p.problem) return { ok: false as const, message: p.problem };
    // In someone else's cart for the same thing already: it stays there.
    await q.query("select pg_advisory_xact_lock(hashtext('cart-team:' || $1 || ':' || $2))", [programId, t.orgTeamId ? `o${t.orgTeamId}` : `l${t.teamId}`]);
    const held = (await claims(q, deps.now(), t, programId)).find(
      (c) => (c.coachId !== viewer.coachId || c.invoiceId !== null) && (!reg || clash(c.choice, picked)),
    );
    if (held)
      return {
        ok: false as const,
        message: `${t.name} is already ${held.invoiceId ? `on invoice #${held.invoiceId}, requested by ${held.name}` : `in ${held.name}'s cart`}${held.what ? ` (${held.what})` : ""}.`,
      };
    const n = await q.query<{ n: number }>("select count(*)::int as n from cart_items where coach_id = $1 and removed_at is null", [viewer.coachId]);
    if (n.rows[0].n >= MAX_ITEMS) return { ok: false as const, message: "Your cart is full: pay for it or take something out first." };
    const col = t.orgTeamId ? "org_team_id" : "team_id";
    const old = await q.query(`delete from cart_items where coach_id = $1 and program_id = $2 and ${col} = $3 and removed_at is null and invoice_id is null`, [
      viewer.coachId,
      programId,
      t.orgTeamId ?? t.teamId,
    ]);
    await q.query(
      `insert into cart_items (coach_id, program_id, team_org, org_team_id, team_id, choice, adding, added_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [viewer.coachId, programId, t.org, t.orgTeamId, t.orgTeamId ? null : t.teamId, picked && JSON.stringify(picked), !!reg, deps.now()],
    );
    return { ok: true as const, replaced: !!old.rowCount };
  });
}

// Several of an organization's teams into the cart at once, each with its own pick (Register ALL). Those that can't are
// named with why; the others go in.
export async function addManyToCart(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  org: unknown,
  items: unknown,
): Promise<Result<{ added: number; refused: string[] }>> {
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return { ok: false, message: "Check at least one team." };
  let added = 0;
  const refused: string[] = [];
  for (const x of items as { id?: unknown; choice?: unknown }[]) {
    const r = await addToCart(deps, viewer, programId, { org, orgTeamId: x?.id }, x?.choice);
    if (r.ok) {
      added++;
      continue;
    }
    const name = isId(x?.id) ? (await findTeam(deps.pool, { orgTeamId: x.id }))?.name : undefined;
    refused.push(name && !r.message.startsWith(name) ? `${name}: ${r.message}` : r.message);
  }
  return added || !refused.length ? { ok: true, added, refused } : { ok: false, message: refused.join(" ") };
}

// Whether two picks are the same thing: ALL Season twice, the same date (a 2nd Game is its own), or a date ALL Season covers.
function clash(a: Choice | null, b: Choice | null): boolean {
  if (!a || !b) return true;
  const first = (c: Choice) => c.days.some((d) => d.kind !== "single_2nd");
  if ((a.allSeason && (b.allSeason || first(b))) || (b.allSeason && first(a))) return true;
  return a.days.some((x) => b.days.some((y) => x.date === y.date && (x.kind === "single_2nd") === (y.kind === "single_2nd")));
}

type Claim = { coachId: string; name: string; programId: string; choice: Choice | null; what: string; invoiceId: string | null };

// Whose carts a team is in (one program, or all), as they stand: an item that would come out by itself (the team is
// registered, its dates were added, that person may no longer register it or isn't active) doesn't count.
async function claims(q: Pick<Queryable, "query">, now: Date, t: Found, programId: string | null): Promise<Claim[]> {
  const r = await q.query<ClaimRow>(
    `select c.coach_id, u.first_name as first, u.last_name as last, c.program_id::text, c.choice, c.adding, c.added_at,
            c.invoice_id::text, i.due_on::text
       from cart_items c join users u on u.coach_id = c.coach_id left join cart_invoices i on i.id = c.invoice_id
      where c.removed_at is null and u.active and ($1::bigint is null or c.program_id = $1)
        and ${t.orgTeamId ? "c.org_team_id" : "c.team_id"} = $2 order by c.added_at, c.id`,
    [programId, t.orgTeamId ?? t.teamId],
  );
  const out: Claim[] = [];
  for (const c of r.rows) {
    const s = await standing(q, now, c, t);
    if (s) out.push({ coachId: c.coach_id, name: `${c.first} ${c.last}`, programId: c.program_id, choice: s.choice, what: s.choice ? pickedLine(s.choice) : "", invoiceId: c.invoice_id ?? null });
  }
  return out;
}

export type ClaimRow = {
  coach_id: string;
  first: string;
  last: string;
  program_id: string;
  choice: Choice | null;
  adding: boolean;
  added_at: Date;
  invoice_id?: string | null; // on a requested invoice (not in the cart itself)
  due_on?: string | null; // …which can be paid until this day
};

// Out of time: in the cart for 7 days; on an invoice, past its due date.
const ranOut = (c: { added_at: Date; due_on?: string | null }, now: Date) => (c.due_on ? easternDate(now) > c.due_on : expired(c.added_at, now));

// An item as it stands (what's left of it, and whether the team is registered); null: it would come out by itself.
export async function standing(q: Pick<Queryable, "query">, now: Date, c: ClaimRow, t: Found): Promise<{ choice: Choice | null; registered: boolean } | null> {
  if (ranOut(c, now)) return null;
  const reg = await registration(q, c.program_id, t.teamId);
  if (reg?.out || (reg && !c.adding)) return null;
  let choice = c.choice;
  if (reg && choice) {
    choice = await stillToAdd(q, c.program_id, t, choice);
    if (!choice) return null;
  }
  const who = { coachId: c.coach_id, firstName: c.first, lastName: c.last } as SessionUser; // rights are read by their id
  return (await mayNot(q, who, t, !!reg)) ? null : { choice, registered: !!reg };
}

// What's left of a pick once the dates (or ALL Season) the team has since are taken off; null: nothing.
async function stillToAdd(q: Pick<Queryable, "query">, programId: string, t: Found, picked: Choice): Promise<Choice | null> {
  const { entry } = await leagueEntry(q, programId, t.teamId, t.org, t.level);
  const left: Choice = {
    allSeason: picked.allSeason && !entry?.allSeason,
    days: picked.days.filter((d) => !entry?.days.some((x) => x.date === d.date && x.kind === d.kind)),
  };
  return left.allSeason || left.days.length ? left : null;
}

// For a team's page (shown to whoever may register it or add to it): the carts it's in, by program.
export type InCart = { programId: string; mine: boolean; name: string; what: string; invoiceId: string | null };
export async function inCarts(q: Pick<Queryable, "query">, now: Date, viewer: SessionUser, team: { orgTeamId?: string; teamId?: string }): Promise<InCart[]> {
  const t = await findTeam(q, team);
  if (!t) return [];
  return (await claims(q, now, t, null)).map((c) => ({ programId: c.programId, mine: c.coachId === viewer.coachId, name: c.name, what: c.what, invoiceId: c.invoiceId }));
}

// Take one out (only the person's own), or dismiss a note about one that came out by itself.
export async function removeFromCart(deps: Deps, viewer: SessionUser, id: unknown): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That isn't in your cart." };
  // (An item on a requested invoice comes off by cancelling the invoice.)
  await deps.pool.query("delete from cart_items where id = $1 and coach_id = $2 and (invoice_id is null or removed_at is not null)", [id, viewer.coachId]);
  return { ok: true };
}

// What an item costs now, what it's for, and why it can't be paid for (null: it can). Reads only.
export async function priced(
  q: Pick<Queryable, "query">,
  now: Date,
  x: { programId: string; choice: Choice | null; team: Found; registered: boolean },
): Promise<{ cents: number; what: string; problem: string | null }> {
  const none = { cents: 0, what: "" };
  const p = (
    await q.query<{ kind: string; fee_cents: number | null; opens: string; closes: string }>(
      "select kind, fee_cents, reg_opens::text as opens, reg_closes::text as closes from scenic_programs where id = $1",
      [x.programId],
    )
  ).rows[0];
  if (!p) return { ...none, problem: "That program no longer exists." };
  const today = easternDate(now);
  const shut = today < p.opens ? "Registration isn't open yet." : today > p.closes && !x.registered ? "Registration is closed." : null;
  if (p.kind !== "League") return { cents: x.registered ? 0 : (p.fee_cents ?? 0), what: p.kind, problem: shut };
  const { options, gameDates, entry } = await leagueEntry(q, x.programId, x.registered ? x.team.teamId : null, x.team.org, x.team.level);
  if (!options.length)
    // A League without registration options: its one fee.
    return { cents: x.registered ? 0 : (p.fee_cents ?? 0), what: "League", problem: shut };
  const had: Choice = entry ? { allSeason: entry.allSeason, days: entry.days } : { allSeason: false, days: [] };
  const add = x.choice ?? { allSeason: false, days: [] };
  const plan = planChoice(options, gameDates, had, add);
  if ("error" in plan) return { ...none, what: pickedLine(add), problem: shut ?? plan.error };
  const past = add.days.some((d) => d.date < today) ? "Past Game Days can't be picked." : null;
  return {
    cents: plan.newFeeCents,
    what: pickedLine(add) || entryLine({ ...plan.merged, ...plan.result }),
    problem: shut ?? past ?? closedReason(options, gameDates, had, add, today),
  };
}

const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

type Row = {
  id: string;
  program_id: string;
  program: string;
  team_org: string;
  org_team_id: string | null;
  team_id: string | null;
  choice: Choice | null;
  adding: boolean;
  added_at: Date;
  invoice_id: string | null;
  due_on: string | null;
};

// until: the day it comes out by itself (YYYY-MM-DD).
export type CartLine = { id: string; team: string; level: string; what: string; adding: boolean; cents: number; problem: string | null; until: string };
export type CartGroup = {
  org: string;
  orgName: string;
  programId: string;
  program: string;
  lines: CartLine[];
  cents: number; // what can be paid for
  cardCents: number; // the card fee added for the team when paid by card
  payLater: boolean; // may register now and pay its invoice later
};
export type Cart = { groups: CartGroup[]; count: number; gone: { id: string; why: string }[] };

// The person's cart as it stands: what came out by itself is taken out first (`gone` says why), then each item priced.
// `org`: only that organization's teams (its Home); left out: all of it.
export async function getCart(deps: PayDeps, viewer: SessionUser, org?: string): Promise<Cart> {
  if (!(await deps.pool.query("select 1 from cart_items where coach_id = $1 limit 1", [viewer.coachId])).rowCount) return { groups: [], count: 0, gone: [] };
  return withTx(deps.pool, async (q) => {
    const items = await tidy(q, deps.now(), viewer);
    const shown = items.filter((x) => !x.row.invoice_id && (!org || x.row.team_org === org));
    const to = await payee(q, deps.stripe);
    const groups = new Map<string, CartGroup>();
    for (const { row, team, registered } of shown) {
      const key = `${row.team_org} ${row.program_id}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          org: row.team_org,
          orgName: await orgName(q, row.team_org),
          programId: row.program_id,
          program: row.program,
          lines: [],
          cents: 0,
          cardCents: 0,
          payLater: await payLater(q, row.program_id, row.team_org),
        };
        groups.set(key, g);
      }
      const p = await priced(q, deps.now(), { programId: row.program_id, choice: row.choice, team, registered });
      g.lines.push({ id: row.id, team: team.name, level: team.level, what: p.what, adding: registered, cents: p.cents, problem: p.problem, until: untilDay(row.added_at) });
      if (!p.problem) g.cents += p.cents;
    }
    for (const g of groups.values()) {
      g.lines.sort((a, b) => a.team.localeCompare(b.team, undefined, { numeric: true }));
      g.cardCents = to?.fee_payer === "team" ? cardFee(g.cents) : 0;
    }
    const gone = await q.query<{ id: string; why: string }>(
      `select id::text, removed_why as why from cart_items where coach_id = $1 and removed_at is not null and ($2::text is null or team_org = $2) order by removed_at desc, id`,
      [viewer.coachId, org ?? null],
    );
    return { groups: [...groups.values()], count: shown.length, gone: gone.rows };
  });
}

const untilDay = (added: Date) => easternDate(new Date(added.getTime() + CART_DAYS * DAY));

export type Item = { row: Row; team: Found; registered: boolean };

// Takes out what's no longer theirs to pay for: a team someone registered meanwhile (dates someone added come off the
// item), a team that's gone, or one they may no longer register. Locked, so a payment can't start on a stale cart.
export async function tidy(q: PoolClient, now: Date, viewer: SessionUser): Promise<Item[]> {
  await q.query("select pg_advisory_xact_lock(hashtext('cart:' || $1))", [viewer.coachId]);
  await q.query("delete from cart_items where coach_id = $1 and removed_at < $2::timestamptz - interval '7 days'", [viewer.coachId, now]);
  const rows = (
    await q.query<Row>(
      `select c.id::text, c.program_id::text, p.name as program, c.team_org, c.org_team_id::text, c.team_id::text, c.choice, c.adding, c.added_at,
              c.invoice_id::text, i.due_on::text
         from cart_items c join scenic_programs p on p.id = c.program_id left join cart_invoices i on i.id = c.invoice_id
        where c.coach_id = $1 and c.removed_at is null order by p.starts_on, c.added_at, c.id`,
      [viewer.coachId],
    )
  ).rows;
  const out: Item[] = [];
  for (const row of rows) {
    const gone = (why: string) => q.query("update cart_items set removed_at = $2, removed_why = $3 where id = $1", [row.id, now, why]);
    const team = await findTeam(q, { orgTeamId: row.org_team_id, teamId: row.team_id });
    if (!team) {
      await gone(`A team in your cart for ${row.program} is gone or archived.`);
      continue;
    }
    if (ranOut(row, now)) {
      await gone(
        row.invoice_id
          ? `${team.name} (${row.program}): invoice #${row.invoice_id} wasn't paid by ${short(row.due_on!)}.`
          : `${team.name} (${row.program}): it was in your cart for ${CART_DAYS} days.`,
      );
      continue;
    }
    const reg = await registration(q, row.program_id, team.teamId);
    if (reg?.out) {
      await gone(`${team.name}: the League took it out of ${row.program}.`);
      continue;
    }
    if (reg && !row.adding) {
      await gone(`${team.name} was registered for ${row.program} by ${reg.by}.`);
      continue;
    }
    if (reg && row.choice) {
      // Dates (or ALL Season) it has since: they come off; nothing left, it comes out.
      const left = await stillToAdd(q, row.program_id, team, row.choice);
      if (!left) {
        await gone(`${team.name}: what you picked for ${row.program} was already added.`);
        continue;
      }
      if (left.allSeason !== row.choice.allSeason || left.days.length !== row.choice.days.length) {
        await q.query("update cart_items set choice = $2 where id = $1", [row.id, JSON.stringify(left)]);
        row.choice = left;
      }
    }
    if (await mayNot(q, viewer, team, !!reg)) {
      await gone(`${team.name}: you no longer register it for ${row.program}.`);
      continue;
    }
    out.push({ row, team, registered: !!reg });
  }
  // An invoice with nothing left on it is closed.
  await q.query(
    `update cart_invoices i set cancelled_by = 'CourtCaptain', cancelled_at = $2
      where i.coach_id = $1 and i.paid_at is null and i.cancelled_at is null
        and not exists (select 1 from cart_items c where c.invoice_id = i.id and c.removed_at is null)`,
    [viewer.coachId, now],
  );
  return out;
}

export type PayCartResult = Result<
  | { pay: string; payInPage?: undefined; choose?: undefined; registered?: undefined } // Stripe's page
  | { payInPage: InPage; pay?: undefined; choose?: undefined; registered?: undefined } // Stripe's form in the page
  | { choose: { cents: number; card: number }; pay?: undefined; payInPage?: undefined; registered?: undefined } // Pay later organization: asked first
  | { registered: number; pay?: undefined; payInPage?: undefined; choose?: undefined } // done now (nothing to pay by card, or Pay later)
>;

export class Stop extends Error {}

// Pay for one group of the cart (an organization's teams in one program): one card payment, its teams registered together
// once Stripe says it's paid. `mode`: a Pay later organization chooses "card" or "later" (registered now, on its invoice).
// Every item is checked again, all or none.
export async function payCart(
  deps: PayDeps,
  viewer: SessionUser,
  org: unknown,
  programId: unknown,
  base: string,
  mode?: unknown,
  inPage = false,
): Promise<PayCartResult> {
  if (!isId(programId) || typeof org !== "string" || !org) return { ok: false, message: "That isn't in your cart." };
  return payItems(deps, viewer, viewer, { org, programId, invoiceId: null }, base, mode, inPage, `/org/${encodeURIComponent(org)}?open=invoices&paid=cancelled`);
}

// Pays for a group of `owner`'s items: in their cart, or on an invoice they requested (`viewer` pays it). See payCart.
export async function payItems(
  deps: PayDeps,
  viewer: SessionUser,
  owner: SessionUser,
  what: { org: string; programId: string; invoiceId: string | null },
  base: string,
  mode: unknown,
  inPage: boolean,
  cancelPage: string,
): Promise<PayCartResult> {
  const { org, programId, invoiceId } = what;
  const to = await payee(deps.pool, deps.stripe);
  let done: { registered: number } | { choose: { cents: number; card: number } } | { paymentId: string } | { stale: true };
  try {
    done = await withTx(deps.pool, async (q) => {
      const before = (await q.query<{ n: number }>("select count(*)::int as n from cart_items where coach_id = $1 and removed_at is null", [owner.coachId])).rows[0].n;
      const all = await tidy(q, deps.now(), owner);
      if (all.length !== before) return { stale: true as const }; // something came out: kept, and shown before paying
      const items = all.filter((x) => x.row.team_org === org && x.row.program_id === programId && x.row.invoice_id === invoiceId);
      if (!items.length) throw new Stop("Nothing to pay for here.");
      const status = await programRegStatus(q, programId, deps.now());
      if (!status) throw new Stop("That program no longer exists.");
      const later = !invoiceId && (await payLater(q, programId, org));
      const payable: PayTeam[] = [];
      // Each team's copy in the League first (kept), then what registering them all would cost, undone if it's paid first.
      const teams: { item: Item; teamId: string }[] = [];
      for (const item of items)
        teams.push({
          item,
          teamId: item.team.orgTeamId
            ? await copyOf(q, item.team.orgTeamId, await partnerFor(q, item.team.org as never, by(viewer)), by(viewer), deps.now())
            : item.team.teamId!,
        });
      const wasPaid = new Map<string, boolean>();
      await q.query("savepoint cart");
      for (const { item, teamId } of teams) {
        if (!item.registered && status !== "open") throw new Stop(`${item.team.name}: registration isn't open.`);
        const p = await priced(q, deps.now(), { programId, choice: item.row.choice, team: { ...item.team, teamId }, registered: item.registered });
        if (p.problem) throw new Stop(`${item.team.name}: ${p.problem}`);
        const r = await q.query<{ paid: boolean }>("select paid from scenic_registrations where program_id = $1 and team_id = $2 for update", [programId, teamId]);
        if (r.rows[0]) wasPaid.set(teamId, r.rows[0].paid);
        const cost = await owed(q, programId, teamId, item.row.choice ?? undefined, by(viewer), deps.now());
        if ("error" in cost) throw new Stop(`${item.team.name}: ${cost.error}`);
        payable.push({ teamId, orgTeamId: item.team.orgTeamId, choice: item.row.choice ?? undefined, cents: cost.cents });
      }
      const total = payable.reduce((n, t) => n + t.cents, 0);
      const clear = async () => {
        await q.query("delete from cart_items where id = any($1::bigint[])", [items.map((x) => x.row.id)]);
        if (invoiceId) await q.query("update cart_invoices set paid_by = $2, paid_at = $3 where id = $1", [invoiceId, by(viewer), deps.now()]); // nothing to pay
      };
      const registerNow = async () => {
        // Already saved above (owed runs it). More owed on a paid registration: unpaid until the rest is paid.
        for (const t of payable) if (wasPaid.get(t.teamId) && t.cents > 0) await owesMore(q, programId, t.teamId, t.cents, by(viewer), deps.now());
        await clear();
        return { registered: payable.length };
      };
      if (!total) return registerNow();
      if (later && (mode === "later" || !to)) return registerNow();
      if (!to) throw new Stop(NO_CARDS); // stays in the cart until it can be paid
      await q.query("rollback to savepoint cart");
      if (later && mode !== "card") return { choose: { cents: total, card: to.fee_payer === "team" ? cardFee(total) : 0 } };
      const paymentId = await insertPayment(q, to, { programId, teamOrg: org, teams: payable, startedBy: by(viewer), now: deps.now() });
      await q.query("update registration_payments set cart_items = $2, cart_invoice_id = $3 where id = $1", [paymentId, items.map((x) => x.row.id), invoiceId]);
      return { paymentId };
    });
  } catch (e) {
    if (e instanceof Stop) return { ok: false, message: e.message };
    throw e;
  }
  if ("stale" in done) return { ok: false, message: "Your cart changed (a team was registered or is gone). Check it and try again." };
  if ("choose" in done || "registered" in done) return { ok: true, ...done };
  // The items stay in the cart until Stripe says it's paid (confirmPayment takes them out): Cancel keeps them.
  if (inPage) return { ok: true, payInPage: await openCheckoutInPage(deps, done.paymentId, base) };
  return { ok: true, pay: await openCheckout(deps, done.paymentId, base, cancelPage) };
}

// ---- The League's side (its Owners): what's in everyone's carts for a program ----

const LEAGUE = "scenic-city";

export type ProgramCartItem = {
  id: string;
  who: string; // whose cart
  org: string;
  orgName: string;
  team: string;
  level: string;
  what: string;
  adding: boolean;
  cents: number;
  problem: string | null;
  due: string; // registered now to pay later: its due date (the day before its first event)
  added: string; // YYYY-MM-DD
  until: string; // the day it comes out by itself
};

// By organization, then whose cart, then team. Null: not one of the League's Owners.
export async function programCarts(q: Pick<Queryable, "query">, viewer: SessionUser, programId: unknown, now: Date): Promise<ProgramCartItem[] | null> {
  if (!isId(programId) || !(await isOrgOwner(q, viewer.coachId, LEAGUE))) return null;
  const r = await q.query<ClaimRow & { id: string; team_org: string; org_team_id: string | null; team_id: string | null }>(
    `select c.id::text, c.coach_id, u.first_name as first, u.last_name as last, c.program_id::text, c.team_org, c.org_team_id::text, c.team_id::text,
            c.choice, c.adding, c.added_at
       from cart_items c join users u on u.coach_id = c.coach_id where c.program_id = $1 and c.removed_at is null and c.invoice_id is null and u.active order by c.added_at, c.id`,
    [programId],
  );
  const out: ProgramCartItem[] = [];
  for (const c of r.rows) {
    const team = await findTeam(q, { orgTeamId: c.org_team_id, teamId: c.team_id });
    const s = team && (await standing(q, now, c, team));
    if (!team || !s) continue;
    const p = await priced(q, now, { programId, choice: s.choice, team, registered: s.registered });
    out.push({
      id: c.id,
      who: `${c.first} ${c.last}`,
      org: team.org,
      orgName: await orgName(q, team.org),
      team: team.name,
      level: team.level,
      what: p.what,
      adding: s.registered,
      cents: p.cents,
      problem: p.problem,
      due: await payLaterDue(q, now, programId, s.choice),
      added: easternDate(c.added_at),
      until: untilDay(c.added_at),
    });
  }
  return out.sort((a, b) => a.orgName.localeCompare(b.orgName) || a.who.localeCompare(b.who) || a.team.localeCompare(b.team, undefined, { numeric: true }));
}

// The day before what's picked is first played: its earliest date; ALL Season, the League's next Game Day; anything else,
// the program's first day. YYYY-MM-DD.
export async function payLaterDue(q: Pick<Queryable, "query">, now: Date, programId: string, choice: Choice | null): Promise<string> {
  const r = (
    await q.query<{ starts: string; next: string | null }>(
      `select p.starts_on::text as starts, (select min(g.day)::text from program_game_days pg join game_days g on g.id = pg.game_day_id
          where pg.program_id = p.id and pg.kind = 'game' and g.day >= $2::date) as next
         from scenic_programs p where p.id = $1`,
      [programId, easternDate(now)],
    )
  ).rows[0];
  const dates = [...(choice?.days.map((d) => d.date) ?? []), ...(choice?.allSeason && r.next ? [r.next] : [])].sort();
  const event = dates[0] ?? r.next ?? r.starts;
  return new Date(new Date(`${event}T12:00:00Z`).getTime() - DAY).toISOString().slice(0, 10);
}

// Register one of them now, to be paid later (a League Owner, case by case): out of that person's cart (telling them), its
// fee owed on their organization's invoice, due the day before its first event (past due the day of). Who did it is
// recorded.
export async function registerPayLater(deps: Deps, viewer: SessionUser, itemId: unknown): Promise<Result<{ programId: string; org: string; team: string }>> {
  if (!isId(itemId)) return { ok: false, message: "That isn't in a cart any more." };
  try {
    return await withTx(deps.pool, async (q) => {
      if (!(await isOrgOwner(q, viewer.coachId, LEAGUE))) throw new Stop("Only the League's Owners can do that.");
      const owner = (await q.query<{ coach_id: string }>("select coach_id from cart_items where id = $1 and removed_at is null and invoice_id is null", [itemId])).rows[0];
      if (!owner) throw new Stop("That isn't in a cart any more.");
      await q.query("select pg_advisory_xact_lock(hashtext('cart:' || $1))", [owner.coach_id]); // not while they pay or change it
      const c = (
        await q.query<ClaimRow & { org_team_id: string | null; team_id: string | null; program: string }>(
          `select c.coach_id, u.first_name as first, u.last_name as last, c.program_id::text, c.org_team_id::text, c.team_id::text, c.choice, c.adding,
                  c.added_at, p.name as program
             from cart_items c join users u on u.coach_id = c.coach_id and u.active join scenic_programs p on p.id = c.program_id
            where c.id = $1 and c.removed_at is null and c.invoice_id is null for update of c`,
          [itemId],
        )
      ).rows[0];
      const team = c && (await findTeam(q, { orgTeamId: c.org_team_id, teamId: c.team_id }));
      const s = team && (await standing(q, deps.now(), c, team));
      if (!c || !team || !s) throw new Stop("That isn't in a cart any more.");
      const status = await programRegStatus(q, c.program_id, deps.now());
      if (!s.registered && status !== "open") throw new Stop("Registration isn't open for this program.");
      const p = await priced(q, deps.now(), { programId: c.program_id, choice: s.choice, team, registered: s.registered });
      if (p.problem) throw new Stop(p.problem);
      const now = deps.now();
      const teamId = team.orgTeamId ? await copyOf(q, team.orgTeamId, await partnerFor(q, team.org as never, by(viewer)), by(viewer), now) : team.teamId!;
      const was = (await q.query<{ paid: boolean }>("select paid from scenic_registrations where program_id = $1 and team_id = $2 for update", [c.program_id, teamId])).rows[0];
      const due = await payLaterDue(q, now, c.program_id, s.choice);
      const cost = await owed(q, c.program_id, teamId, s.choice ?? undefined, by(viewer), now); // registers it
      if ("error" in cost) throw new Stop(cost.error);
      if (was?.paid && cost.cents > 0) await owesMore(q, c.program_id, teamId, cost.cents, by(viewer), now);
      if (cost.cents > 0)
        // (Owing for something earlier already: that date stays if it's sooner.)
        await q.query(
          `update scenic_registrations set pay_later_by = $3, pay_later_at = $4,
                  pay_later_due = case when $6 and pay_later_due is not null then least(pay_later_due, $5::date) else $5::date end
            where program_id = $1 and team_id = $2`,
          [c.program_id, teamId, by(viewer), now, due, !!was && !was.paid],
        );
      await q.query("update cart_items set removed_at = $2, removed_why = $3 where id = $1", [
        itemId,
        now,
        `${team.name}: ${await orgName(q, LEAGUE)} registered it for ${c.program}${cost.cents > 0 ? `, to pay later: due ${short(due)}` : ""}.`,
      ]);
      return { ok: true as const, programId: c.program_id, org: team.org, team: team.name };
    });
  } catch (e) {
    if (e instanceof Stop) return { ok: false, message: e.message };
    throw e;
  }
}
