// Registrations (Home card). A CourtEvents organization (Scenic City): every team registered in its programs that are
// current (not ended more than 30 days ago), with what it registered for, its fee and Paid, who registered it and when,
// and its Head Coach's cell and email. Its Owners only for now (it shows contact details); null for anyone else.
// The page offers several views of the same rows (newest first, by division, by organization, unpaid).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { entryLine, optionName } from "./program-options";
import { isOrgOwner } from "./org-admin";
import { isOrgSlug } from "./orgs";
import { getProgram, listPrograms } from "./scenic-programs";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };

export type TeamRegistration = {
  programId: string;
  program: string;
  teamId: string;
  team: string;
  tag: string; // its organization's or club's Abbreviation, or "Solo"
  from: string; // the organization or club it comes from
  gradeLabel: string;
  level: string;
  division: string; // "Boys 4th–5th"
  group: string; // "5th COMP · Pool A"
  registeredFor: string | null; // a League: ALL Season or its dates
  feeCents: number | null;
  paid: boolean;
  paidSetBy: string | null; // who last marked it Paid or Unpaid
  registeredBy: string;
  registeredAt: string; // ISO
  coach: string | null;
  coachCell: string | null;
  coachEmail: string | null;
  out: boolean; // taken out of the program (still listed)
  // Its account, newest first: the registration, each date or 2nd Game added, Brackets added, Paid marks, taken out. Each
  // with when, who and (what was bought) its fee at this team's prices.
  activity: Activity[];
  lastAt: string; // ISO: its newest activity (the list's order)
};
export type Activity = { at: string; by: string; what: string; cents: number | null };

export async function teamRegistrations(
  deps: Deps,
  viewer: SessionUser,
  programId?: string, // one program's (its card under Programs)
): Promise<{ programs: { id: string; name: string }[]; rows: TeamRegistration[] } | null> {
  if (!(await isOrgOwner(deps.pool, viewer.coachId, "scenic-city"))) return null;
  const list = await listPrograms(deps, viewer);
  if (!list) return null;
  const since = easternDate(new Date(deps.now().getTime() - 30 * 86_400_000));
  const current = list.programs.filter((p) => (programId ? p.id === programId : p.endsOn >= since));
  const details = (await Promise.all(current.map((p) => getProgram(deps, viewer, p.id)))).filter((p) => !!p);
  // Each registration's dated changes: its Game Days (each added on its own), Brackets added, Paid marks and taken out.
  const ids = details.map((p) => p.id);
  const [daysAdded, regMeta] = await Promise.all([
    deps.pool.query<{ program: string; team: string; day: string; kind: string; by: string; at: Date }>(
      `select d.program_id::text as program, d.team_id::text as team, to_char(g.day, 'YYYY-MM-DD') as day, d.kind, d.registered_by as by, d.registered_at as at
         from scenic_registration_days d join game_days g on g.id = d.game_day_id where d.program_id = any($1::bigint[])`,
      [ids],
    ),
    deps.pool.query<{ program: string; team: string; all_season: boolean; bracket_by: string | null; bracket_at: Date | null; paid: boolean; paid_by: string | null; paid_at: Date | null; removed_by: string | null; removed_at: Date | null }>(
      `select program_id::text as program, team_id::text as team, all_season, bracket_by, bracket_at, paid, paid_set_by as paid_by, paid_set_at as paid_at, removed_by, removed_at
         from scenic_registrations where program_id = any($1::bigint[])`,
      [ids],
    ),
  ]);
  const meta = new Map(regMeta.rows.map((m) => [`${m.program}-${m.team}`, m]));
  const iso = (d: Date) => new Date(d).toISOString();
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const KIND_GG: Record<string, string> = { single_1: "1GG", single_2: "2GG", single_2nd: "now 2GG" };
  const activityOf = (programId: string, t: { teamId: string; registeredBy: string; registeredAt: Date; prices?: Record<string, number> }): Activity[] => {
    const m = meta.get(`${programId}-${t.teamId}`);
    const price = (k: string) => (t.prices ? (t.prices[k] ?? 0) : null);
    const list: Activity[] = [
      {
        at: iso(t.registeredAt),
        by: t.registeredBy,
        what: m?.all_season ? "Registered: ALL Season (1GG each Game Day)" : "Registered",
        cents: m?.all_season ? price("all_season") : null,
      },
      ...daysAdded.rows
        .filter((d) => d.program === programId && d.team === t.teamId)
        .map((d) => ({ at: iso(d.at), by: d.by, what: `${day(d.day)}: ${optionName(d.kind)} (${KIND_GG[d.kind] ?? d.kind})`, cents: price(d.kind) })),
      ...(m?.bracket_at && m.bracket_by ? [{ at: iso(m.bracket_at), by: m.bracket_by, what: "Added to the Brackets", cents: null }] : []),
      ...(m?.paid_at && m.paid_by ? [{ at: iso(m.paid_at), by: m.paid_by, what: m.paid ? "Marked Paid" : "Marked Unpaid", cents: null }] : []),
      ...(m?.removed_at && m.removed_by ? [{ at: iso(m.removed_at), by: m.removed_by, what: "Taken out of the program", cents: null }] : []),
    ];
    // Newest first; the registration before anything made with it at the same moment.
    return list.sort((a, b) => b.at.localeCompare(a.at) || Number(b.what.startsWith("Registered")) - Number(a.what.startsWith("Registered")));
  };
  const rows: TeamRegistration[] = [];
  for (const p of details)
    for (const d of p.divisionList)
      for (const g of d.groups)
        for (const pool of g.pools)
          for (const t of pool.teams)
            rows.push({
              programId: p.id,
              program: p.name,
              teamId: t.teamId,
              team: t.name,
              tag: t.tag,
              from: t.from,
              gradeLabel: t.gradeLabel,
              level: t.level,
              division: d.label,
              group: g.pools.length > 1 ? `${g.label} · Pool ${pool.name}` : g.label,
              registeredFor: t.entry ? entryLine(t.entry) : null,
              feeCents: t.entry ? t.entry.feeCents : p.feeCents,
              paid: t.paid,
              paidSetBy: t.paidSetBy,
              registeredBy: t.registeredBy,
              registeredAt: new Date(t.registeredAt).toISOString(),
              coach: t.coach,
              coachCell: t.coachCell,
              coachEmail: t.coachEmail,
              out: !!t.removedBy,
              ...(() => {
                const activity = activityOf(p.id, t);
                return { activity, lastAt: activity.reduce((m, x) => (x.at > m ? x.at : m), activity[0].at) };
              })(),
            });
  // The most recent activity first.
  rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.team.localeCompare(b.team));
  return { programs: details.map((p) => ({ id: p.id, name: p.name })), rows };
}

// ---- Players (a CourtPlayers organization: Thunder) ----

export type PlayerRegistration = {
  registrantId: string;
  programId: string | null;
  program: string; // the player program, else what they registered for in TeamSnap ("4th Girls")
  firstName: string;
  lastName: string;
  gender: string;
  grade: string; // "K", "1" … "12"
  gradeSort: number;
  birthdate: string | null; // YYYY-MM-DD
  team: string | null; // the team they're rostered on
  parent: string | null;
  parentCell: string | null;
  parentEmail: string | null;
  parent2: string | null;
  parent2Cell: string | null;
  parent2Email: string | null;
  coachRequest: string | null;
  uniformSize: string | null;
  totalFees: string | null; // "185.00"
  amountPaid: string | null;
  amountRemaining: string | null;
  checkout: string | null; // how they paid in TeamSnap (Paid in full, Payment plan…)
  feesWaivedBy: string | null;
  addedBy: string | null; // added in the app (not from TeamSnap)
  registeredAt: string | null; // ISO
};

// Every player registered with the organization (its player programs; Thunder's TeamSnap registrations and players
// added in the app), newest first. Its Owners only for now; null for anyone else.
export async function playerRegistrations(
  deps: Deps,
  viewer: SessionUser,
  org: string,
): Promise<{ programs: { id: string; name: string }[]; rows: PlayerRegistration[] } | null> {
  if (!isOrgSlug(org) || !(await isOrgOwner(deps.pool, viewer.coachId, org))) return null;
  const r = await deps.pool.query<PlayerRegistration>(
    `select r.registrant_id as "registrantId", r.program_id::text as "programId", coalesce(pp.name, r.program) as program,
            r.first_name as "firstName", r.last_name as "lastName", r.gender, r.grade, r.grade_sort as "gradeSort",
            to_char(r.birthdate, 'YYYY-MM-DD') as birthdate, t.name as team,
            nullif(trim(coalesce(r.parent1_first, '') || ' ' || coalesce(r.parent1_last, '')), '') as parent,
            r.parent1_cell as "parentCell", r.parent1_email as "parentEmail",
            nullif(trim(coalesce(r.parent2_first, '') || ' ' || coalesce(r.parent2_last, '')), '') as parent2,
            r.parent2_cell as "parent2Cell", r.parent2_email as "parent2Email",
            nullif(trim(r.coach_request), '') as "coachRequest", nullif(trim(r.uniform_size), '') as "uniformSize",
            r.total_fees::text as "totalFees", r.amount_paid::text as "amountPaid", r.amount_remaining::text as "amountRemaining",
            nullif(trim(r.checkout_type), '') as checkout, r.fees_waived_by as "feesWaivedBy", r.added_by as "addedBy",
            to_char(coalesce(r.registered_at, r.added_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "registeredAt"
       from registrations r
       left join player_programs pp on pp.id = r.program_id
       left join lateral (select x.name from team_players p join teams x on x.id = p.team_id
                           where p.registrant_id = r.registrant_id order by x.name limit 1) t on true
      where coalesce(pp.org, 'thunder') = $1
      order by coalesce(r.registered_at, r.added_at) desc nulls last, lower(r.last_name), lower(r.first_name)`,
    [org],
  );
  const programs = [...new Map(r.rows.map((p) => [p.programId ?? `name:${p.program}`, p.program])).entries()].map(([id, name]) => ({
    id,
    name,
  }));
  return { programs, rows: r.rows };
}
