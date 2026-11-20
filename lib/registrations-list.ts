// Registrations (Home card). A CourtTeams organization (Scenic City): every team registered in its programs that are
// current (not ended more than 30 days ago), with what it registered for, its fee and Paid, who registered it and when,
// and its Head Coach's cell and email. Its Owners only for now (it shows contact details); null for anyone else.
// The page offers several views of the same rows (newest first, by division, by organization, unpaid).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { entryLine } from "./program-options";
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
};

export async function teamRegistrations(
  deps: Deps,
  viewer: SessionUser,
): Promise<{ programs: { id: string; name: string }[]; rows: TeamRegistration[] } | null> {
  if (!(await isOrgOwner(deps.pool, viewer.coachId, "scenic-city"))) return null;
  const list = await listPrograms(deps, viewer);
  if (!list) return null;
  const since = easternDate(new Date(deps.now().getTime() - 30 * 86_400_000));
  const current = list.programs.filter((p) => p.endsOn >= since);
  const details = (await Promise.all(current.map((p) => getProgram(deps, viewer, p.id)))).filter((p) => !!p);
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
            });
  rows.sort((a, b) => b.registeredAt.localeCompare(a.registeredAt) || a.team.localeCompare(b.team));
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
