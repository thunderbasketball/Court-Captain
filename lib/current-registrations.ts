// A team's current registrations (events that haven't ended, not taken out), for its card on the Teams list: "✓ Winter
// (26/27) · Paid" under its name (Thunder's and every organization's teams).
import type { Queryable } from "./sql";
import { gradeLabel, gradeRange } from "./scenic-teams";
import { easternDate } from "./time";

// playsIn: placed by the League in another division ("Boys 2nd–3rd · 2nd: plays up"), else null.
export type CurrentRegistration = { program: string; paid: boolean; playsIn: string | null };
type Row = { id: string; program: string; paid: boolean; g: string | null; low: number | null; high: number | null; grade: number | null; why: string | null };
const PLAYS_IN = `(select d.gender from scenic_pools o join scenic_grade_groups gg on gg.id = o.group_id join scenic_divisions d on d.id = gg.division_id where o.id = r.pool_id and r.plays_in_by is not null) as g,
      (select d.grade_low from scenic_pools o join scenic_grade_groups gg on gg.id = o.group_id join scenic_divisions d on d.id = gg.division_id where o.id = r.pool_id) as low,
      (select d.grade_high from scenic_pools o join scenic_grade_groups gg on gg.id = o.group_id join scenic_divisions d on d.id = gg.division_id where o.id = r.pool_id) as high,
      (select gg.grade from scenic_pools o join scenic_grade_groups gg on gg.id = o.group_id where o.id = r.pool_id) as grade, r.plays_in_why as why`;
const toReg = (x: Row): CurrentRegistration => ({
  program: x.program,
  paid: x.paid,
  playsIn: x.g ? `${x.g} ${gradeRange(x.low!, x.high!)} · ${gradeLabel(x.grade!, x.grade!)}${x.why ? `: ${x.why}` : ""}` : null,
});

// The organization's teams, and how many aren't registered in any event that hasn't ended (its Home's Teams card:
// "Teams (5 · 1 not registered)"). Thunder's teams, or the organization's own.
export async function unregisteredTeams(q: Pick<Queryable, "query">, org: string, now: Date): Promise<{ total: number; unregistered: number }> {
  const thunder = org === "thunder";
  const r = await q.query<{ total: number; unregistered: number }>(
    `select count(*)::int as total,
            count(*) filter (where not exists (
              select 1 from scenic_teams st join scenic_registrations r on r.team_id = st.id join scenic_programs p on p.id = r.program_id
               where ${thunder ? "st.thunder_team_id" : "st.org_team_id"} = t.id and p.ends_on >= $1::date and r.removed_by is null))::int as unregistered
       from ${thunder ? "teams t" : "org_teams t where t.org = $2"}`,
    thunder ? [easternDate(now)] : [easternDate(now), org],
  );
  return r.rows[0];
}

// An organization that runs events (Scenic City): the teams registered in its events that haven't ended, not taken out
// (its Home's Teams card; simulated "(DEV)" teams left out).
export async function eventTeamsCount(q: Pick<Queryable, "query">, org: string, now: Date): Promise<number> {
  const r = await q.query<{ n: number }>(
    `select count(distinct r.team_id)::int as n from scenic_registrations r
       join scenic_programs p on p.id = r.program_id join scenic_teams t on t.id = r.team_id
      where p.org = $1 and p.ends_on >= $2::date and r.removed_by is null and t.name not like '%(DEV)'`,
    [org, easternDate(now)],
  );
  return r.rows[0].n;
}

// League teams' current registrations by their League id (Scenic City's Teams list cards).
export async function leagueRegistrations(q: Pick<Queryable, "query">, ids: string[], now: Date): Promise<Record<string, CurrentRegistration[]>> {
  if (!ids.length) return {};
  const r = await q.query<Row>(
    `select r.team_id::text as id, p.name as program, r.paid, ${PLAYS_IN} from scenic_registrations r join scenic_programs p on p.id = r.program_id
      where r.team_id = any($1::bigint[]) and p.ends_on >= $2::date and r.removed_by is null order by p.starts_on, lower(p.name)`,
    [ids, easternDate(now)],
  );
  const out: Record<string, CurrentRegistration[]> = {};
  for (const x of r.rows) (out[x.id] ??= []).push(toReg(x));
  return out;
}

// A League coach's own teams (Solo teams they own, or teams they're Head Coach of): their Teams card's count.
export async function myLeagueTeamsCount(q: Pick<Queryable, "query">, coachId: string): Promise<number> {
  const r = await q.query<{ n: number }>(
    "select count(*)::int as n from scenic_teams where (coach_id = $1 or owner_coach_id = $1) and name not like '%(DEV)'",
    [coachId],
  );
  return r.rows[0].n;
}

// By the team's id in its organization: `thunder` for Thunder's teams (teams), else an organization's (org_teams).
export async function currentRegistrations(
  q: Pick<Queryable, "query">,
  kind: "thunder" | "org",
  ids: string[],
  now: Date,
): Promise<Record<string, CurrentRegistration[]>> {
  if (!ids.length) return {};
  const col = kind === "thunder" ? "st.thunder_team_id" : "st.org_team_id";
  const r = await q.query<Row>(
    `select ${col}::text as id, p.name as program, r.paid, ${PLAYS_IN} from scenic_registrations r
       join scenic_teams st on st.id = r.team_id join scenic_programs p on p.id = r.program_id
      where ${col} = any($1::bigint[]) and p.ends_on >= $2::date and r.removed_by is null
      order by p.starts_on, lower(p.name)`,
    [ids, easternDate(now)],
  );
  const out: Record<string, CurrentRegistration[]> = {};
  for (const x of r.rows) (out[x.id] ??= []).push(toReg(x));
  return out;
}
