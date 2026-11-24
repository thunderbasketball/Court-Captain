// Invoices (SPEC.md section 14, Payments): one per organization per League program, from the League (Scenic City
// Basketball): each of the organization's registered teams with its division, what it registered for (ALL Season or its
// Game Days), its price (the organization's price group's when it has one) and whether it's paid; the total, paid and
// balance due. Built from the registrations as they are now (so marking Paid, paying, or a team withdrawing updates it).
// Emailed to the organization's Owners on registering (PAID, or PAY LATER with a link), shown on its own page (Print /
// Save as PDF), and an organization with a balance due pays it by card from its Home (lib/stripe: kind 'invoice').
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { isOrgOwner } from "./org-admin";
import { orgName } from "./org-registry";
import { canManageTeams } from "./org-teams";
import { leagueEntry, payLater } from "./scenic-programs";
import { gradeLabel, gradeRange } from "./scenic-teams";
import type { Queryable } from "./sql";
import { easternDate } from "./time";
import type { StripeApi } from "./stripe/connect";
import { insertPayment, openCheckout, openCheckoutInPage, payee, type InPage } from "./stripe/registration";

const LEAGUE = "scenic-city";
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
// A Pay later organization's teams are due this many days after they're registered (or dates are added unpaid).
export const PAY_LATER_DAYS = 30;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export type InvoiceLine = {
  teamId: string; // its League copy
  team: string;
  division: string;
  what: string; // "ALL Season" or its Game Days ("Dec 5, Dec 12 (1 game)")
  cents: number;
  paid: boolean;
  paidCents: number; // all of it once paid; or what was paid before more was added
  paidBy: string | null; // "Card (Stripe)", or the Owner who marked it
  dueOn: string | null; // Pay later, not paid: YYYY-MM-DD, 30 days after it was registered (registered from a cart by the League: the day before its first event)
};
export type Invoice = {
  programId: string;
  program: string;
  dates: string; // "Dec 5 – Feb 28"
  from: string; // the League's name
  org: string;
  orgName: string;
  payLater: boolean; // its price group is Pay later, or a team on it is (case by case)
  lines: InvoiceLine[];
  totalCents: number;
  paidCents: number;
  dueCents: number;
  dueOn: string | null; // Pay later with a balance: its earliest due date (the others are on their lines); null: due now, or paid
};

// The column linking League teams to this organization's own teams.
const ownCol = (org: string) => (org === "thunder" ? "st.thunder_team_id" : "st.org_team_id");
const ownJoin = (org: string) =>
  org === "thunder" ? "st.thunder_team_id is not null" : "st.org_team_id in (select id from org_teams where org = $2)";

export async function buildInvoice(q: Pick<Queryable, "query">, programId: string, org: string): Promise<Invoice | null> {
  const p = (
    await q.query<{ name: string; kind: string; fee_cents: number | null; starts_on: string; ends_on: string }>(
      "select name, kind, fee_cents, starts_on::text, ends_on::text from scenic_programs where id = $1",
      [programId],
    )
  ).rows[0];
  if (!p) return null;
  const r = await q.query<{
    team_id: string;
    team: string;
    gender: string;
    low: number;
    high: number;
    grade: number;
    level: string;
    pool: string;
    paid: boolean;
    paid_set_by: string | null;
    due: string;
    later: boolean;
    paid_cents: number | null;
  }>(
    `select r.team_id::text, st.name as team, d.gender, d.grade_low as low, d.grade_high as high, g.grade, g.level, o.name as pool,
            r.paid, r.paid_set_by, r.pay_later_at is not null as later, r.paid_cents,
            coalesce(r.pay_later_due, ((case when r.paid_set_by like '%(dates added)' then r.paid_set_at else r.registered_at end)
               at time zone 'America/New_York')::date + ${PAY_LATER_DAYS})::text as due
       from scenic_registrations r join scenic_teams st on st.id = r.team_id
       join scenic_pools o on o.id = r.pool_id join scenic_grade_groups g on g.id = o.group_id join scenic_divisions d on d.id = g.division_id
      where r.program_id = $1 and ${ownJoin(org)} ${org === "thunder" ? "and $2::text is not null" : ""}
      order by lower(st.name)`,
    [programId, org],
  );
  if (!r.rows.length) return null;
  const lines: InvoiceLine[] = [];
  const later = await payLater(q, programId, org);
  for (const t of r.rows) {
    let cents = p.fee_cents ?? 0;
    let what = p.kind;
    if (p.kind === "League") {
      const e = (await leagueEntry(q, programId, t.team_id, org, t.level)).entry;
      cents = e?.feeCents ?? 0;
      what = e?.allSeason ? "ALL Season" : e ? e.days.map((x) => day(x.date)).join(", ") || "Game Days" : "League";
    }
    lines.push({
      teamId: t.team_id,
      team: t.team,
      division: `${t.gender} ${gradeRange(t.low, t.high)} · ${gradeLabel(t.grade, t.grade)} ${t.level} · ${t.pool}`,
      what,
      cents,
      paid: t.paid,
      paidCents: t.paid ? cents : Math.min(cents, t.paid_cents ?? 0),
      paidBy: t.paid_set_by,
      dueOn: (later || t.later) && !t.paid && cents > (t.paid_cents ?? 0) ? t.due : null,
    });
  }
  const total = lines.reduce((n, l) => n + l.cents, 0);
  const paid = lines.reduce((n, l) => n + l.paidCents, 0);
  return {
    programId,
    program: p.name,
    dates: `${day(p.starts_on)} – ${day(p.ends_on)}`,
    from: await orgName(q, LEAGUE),
    org,
    orgName: await orgName(q, org),
    payLater: later || r.rows.some((t) => t.later && !t.paid),
    lines,
    totalCents: total,
    paidCents: paid,
    dueCents: total - paid,
    dueOn: lines.flatMap((l) => (l.dueOn ? [l.dueOn] : [])).sort()[0] ?? null,
  };
}

// Who may see an organization's invoice: whoever manages its teams (its Owners, Admins and Directors of Teams; Thunder's
// Directors of Teams) and the League's Owners.
export async function mayViewInvoice(q: Pick<Queryable, "query">, viewer: SessionUser, org: string): Promise<boolean> {
  if (await isOrgOwner(q, viewer.coachId, LEAGUE)) return true;
  return canManageTeams(q, viewer, org);
}

export async function invoiceFor(q: Pick<Queryable, "query">, viewer: SessionUser, programId: unknown, org: unknown): Promise<Invoice | null> {
  if (!isId(programId) || typeof org !== "string" || !org) return null;
  if (!(await mayViewInvoice(q, viewer, org))) return null;
  return buildInvoice(q, programId, org);
}

// An organization's invoices with a balance due (its Home's Invoices card; until 180 days after the program ends), soonest
// program first.
export async function openInvoices(q: Pick<Queryable, "query">, viewer: SessionUser, org: string): Promise<Invoice[]> {
  if (!(await canManageTeams(q, viewer, org))) return [];
  const programs = await q.query<{ id: string }>(
    `select distinct p.id::text, p.starts_on from scenic_registrations r join scenic_programs p on p.id = r.program_id
       join scenic_teams st on st.id = r.team_id
      where not r.paid and p.ends_on >= current_date - 180 and ${ownJoin(org)} ${org === "thunder" ? "and $2::text is not null" : ""}
        and $1::int = 1
      order by p.starts_on`,
    [1, org],
  );
  const out: Invoice[] = [];
  for (const p of programs.rows) {
    const inv = await buildInvoice(q, p.id, org);
    if (inv && inv.dueCents > 0) out.push(inv);
  }
  return out;
}

// Where an invoice stands. PAID: nothing owed. PENDING: requested from a cart, its teams registered once it's paid (built
// with Request an invoice). DUE: a balance, not past its date (Pay later: 30 days; others: due now, no date). PAST DUE: its
// date has passed.
export type InvoiceStatus = "PAID" | "PENDING" | "DUE" | "PAST DUE";
export const INVOICE_STATUSES: InvoiceStatus[] = ["PAST DUE", "DUE", "PENDING", "PAID"];
export const invoiceStatus = (inv: Pick<Invoice, "dueCents" | "dueOn">, today: string): InvoiceStatus =>
  inv.dueCents <= 0 ? "PAID" : inv.dueOn && inv.dueOn < today ? "PAST DUE" : "DUE";

// A League program's invoices, one per organization with teams in it, by organization (the League's Owners; null for anyone
// else). `others`: its teams from no organization (clubs, Solo, FastBreak), which have no invoice, and how many are unpaid.
export async function programInvoices(
  q: Pick<Queryable, "query">,
  viewer: SessionUser,
  programId: unknown,
): Promise<{ invoices: Invoice[]; others: { teams: number; unpaid: number } } | null> {
  if (!isId(programId) || !(await isOrgOwner(q, viewer.coachId, LEAGUE))) return null;
  const [orgs, others] = await Promise.all([
    q.query<{ org: string }>(
      `select distinct coalesce(ot.org, 'thunder') as org from scenic_registrations r join scenic_teams st on st.id = r.team_id
         left join org_teams ot on ot.id = st.org_team_id
        where r.program_id = $1 and (st.org_team_id is not null or st.thunder_team_id is not null)`,
      [programId],
    ),
    q.query<{ teams: number; unpaid: number }>(
      `select count(*)::int as teams, count(*) filter (where not r.paid)::int as unpaid from scenic_registrations r join scenic_teams st on st.id = r.team_id
        where r.program_id = $1 and st.org_team_id is null and st.thunder_team_id is null and st.name not like '%(DEV)'`,
      [programId],
    ),
  ]);
  const invoices = (await Promise.all(orgs.rows.map((o) => buildInvoice(q, programId, o.org)))).filter((i) => !!i);
  invoices.sort((a, b) => a.orgName.localeCompare(b.orgName));
  return { invoices, others: others.rows[0] };
}

// Invoices past due, earliest first: for the League's Owners, every organization's; for whoever manages an organization's
// teams, its own. (Home's warning. One quick read unless something is past due.)
export async function pastDueInvoices(q: Pick<Queryable, "query">, viewer: SessionUser, org: string, now: Date): Promise<Invoice[]> {
  const league = org === LEAGUE;
  if (league ? !(await isOrgOwner(q, viewer.coachId, LEAGUE)) : !(await canManageTeams(q, viewer, org))) return [];
  const today = easternDate(now);
  const r = await q.query<{ program: string; org: string }>(
    `select distinct t.program_id::text as program, t.org
       from (select r.program_id, coalesce(ot.org, case when st.thunder_team_id is not null then 'thunder' end) as org, r.paid_set_by, r.paid_set_at,
                    r.registered_at, r.pay_later_at, r.pay_later_due
               from scenic_registrations r join scenic_teams st on st.id = r.team_id left join org_teams ot on ot.id = st.org_team_id
              where not r.paid) t
       left join scenic_program_org_terms x on x.program_id = t.program_id and x.org = t.org
       left join scenic_price_groups g on g.id = x.group_id
      where t.org is not null and ($1::text is null or t.org = $1) and (g.pay_later or t.pay_later_at is not null)
        and coalesce(t.pay_later_due, ((case when t.paid_set_by like '%(dates added)' then t.paid_set_at else t.registered_at end) at time zone 'America/New_York')::date + ${PAY_LATER_DAYS}) < $2::date`,
    [league ? null : org, today],
  );
  const all = await Promise.all(r.rows.map((x) => buildInvoice(q, x.program, x.org)));
  return all.filter((i) => !!i).filter((i) => invoiceStatus(i, today) === "PAST DUE").sort((a, b) => a.dueOn!.localeCompare(b.dueOn!) || a.orgName.localeCompare(b.orgName));
}

type PayDeps = { pool: Pool; stripe: StripeApi | null; now: () => Date };
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

// Pay the balance of an open invoice by card: one Stripe Checkout for its unpaid teams (their prices), marked Paid once
// Stripe says it's paid. Whoever manages the organization's teams.
export async function payInvoice(
  deps: PayDeps,
  viewer: SessionUser,
  programId: unknown,
  org: unknown,
  base: string,
  inPage = false, // Stripe's form opens in the page (`payInPage`)
): Promise<{ ok: true; pay: string; payInPage?: undefined } | { ok: true; payInPage: InPage; pay?: undefined } | { ok: false; message: string }> {
  if (!isId(programId) || typeof org !== "string") return { ok: false, message: "That invoice wasn't found." };
  if (!(await canManageTeams(deps.pool, viewer, org))) return { ok: false, message: "Only whoever manages the teams can pay." };
  const to = await payee(deps.pool, deps.stripe);
  if (!to || !deps.stripe) return { ok: false, message: "The League isn't taking card payments right now. Pay it the way the League asks." };
  const inv = await buildInvoice(deps.pool, programId, org);
  const unpaid = inv?.lines.filter((l) => !l.paid && l.cents > l.paidCents) ?? [];
  if (!inv || !unpaid.length) return { ok: false, message: "Nothing is due on this invoice." };
  const own = await deps.pool.query<{ id: string; own: string | null }>(
    `select st.id::text, ${ownCol(org)}::text as own from scenic_teams st where st.id = any($1::bigint[])`,
    [unpaid.map((l) => l.teamId)],
  );
  const ownOf = new Map(own.rows.map((r) => [r.id, r.own]));
  const id = await insertPayment(deps.pool, to, {
    programId,
    teamOrg: org,
    teams: unpaid.map((l) => ({ teamId: l.teamId, orgTeamId: ownOf.get(l.teamId) ?? null, choice: undefined, cents: l.cents - l.paidCents })),
    startedBy: by(viewer),
    now: deps.now(),
  });
  await deps.pool.query("update registration_payments set kind = 'invoice' where id = $1", [id]);
  if (inPage) return { ok: true, payInPage: await openCheckoutInPage(deps, id, base) };
  const page = `/invoice/${encodeURIComponent(org)}/${programId}`;
  return { ok: true, pay: await openCheckout(deps, id, base, `${page}?paid=cancelled`) };
}

const longDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// The invoice as an email (plain text): to the organization's Owners. `status`: PAID (all paid) or PAY LATER (a balance
// due, with the link to pay it).
export async function invoiceEmail(q: Pick<Queryable, "query">, programId: string, org: string, appUrl: string) {
  const inv = await buildInvoice(q, programId, org);
  if (!inv) return null;
  const owners = await q.query<{ email: string }>(
    `select distinct coalesce(u.verified_email, u.email) as email from org_roles r join users u on u.coach_id = r.coach_id
      where r.org = $1 and r.role = 'Owner' and coalesce(u.verified_email, u.email) is not null and u.active`,
    [org],
  );
  const link = `${appUrl.replace(/\/+$/, "")}/invoice/${encodeURIComponent(org)}/${programId}`;
  const status = inv.dueCents > 0 ? "PAY LATER" : "PAID";
  const text = [
    `Invoice from ${inv.from}`,
    `${inv.orgName} · ${inv.program} (${inv.dates})`,
    `Status: ${status}`,
    ...(inv.dueOn ? [`Due: ${longDay(inv.dueOn)}`] : []),
    "",
    ...inv.lines.map((l) => `${l.team}\n  ${l.division}\n  ${l.what}: ${money(l.cents)}${l.paid ? " · PAID" : l.paidCents ? ` · ${money(l.paidCents)} paid` : ""}${!l.paid && l.dueOn && l.dueOn !== inv.dueOn ? ` · due ${day(l.dueOn)}` : ""}`),
    "",
    `Total: ${money(inv.totalCents)}`,
    `Paid: ${money(inv.paidCents)}`,
    `Balance due: ${money(inv.dueCents)}`,
    "",
    inv.dueCents > 0 ? `View and pay your invoice: ${link}` : `View your invoice: ${link}`,
  ].join("\n");
  return { to: owners.rows.map((r) => r.email), subject: `${inv.from} invoice: ${inv.program} · ${status}${inv.dueOn ? ` · due ${day(inv.dueOn)}` : ""}`, text, invoice: inv };
}
