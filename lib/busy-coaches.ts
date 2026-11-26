// Coaches on more than 2 teams (SPEC.md section 14): a warning for each organization (Home's To Do, Teams → Warnings). Its Head
// and Assistant Coaches with 3 or more of its teams: Thunder's teams, an organization's own (not archived), or a League's (Scenic
// City) teams registered in its Leagues not ended (taken out ones left out). Each with their teams, to open.
import type { Queryable } from "./sql";
import { easternDate } from "./time";

export const MAX_TEAMS = 2;
export type BusyCoach = { coachId: string; name: string; teams: { id: string; name: string }[] };

const TEAMS: Record<string, string> = {
  thunder: "select s.coach_id, t.id::text as team, t.name from team_staff s join teams t on t.id = s.team_id where s.role in ('HeadCoach', 'AsstCoach') and $1::text is not null",
  "scenic-city": `select x.coach_id, t.id::text as team, t.name
      from scenic_registrations r join scenic_programs p on p.id = r.program_id and p.org = $1 and p.kind = 'League' and p.ends_on >= $2::date
      join scenic_teams t on t.id = r.team_id
      cross join lateral (
        select t.coach_id where t.org_team_id is null and t.thunder_team_id is null
        union select s.coach_id from team_staff s where s.team_id = t.thunder_team_id and s.role in ('HeadCoach', 'AsstCoach')
        union select c.coach_id from org_team_coaches c where c.team_id = t.org_team_id and c.role in ('HeadCoach', 'AsstCoach')
      ) x where r.removed_by is null and x.coach_id is not null`,
};
const ORG_TEAMS =
  "select c.coach_id, t.id::text as team, t.name from org_team_coaches c join org_teams t on t.id = c.team_id where t.org = $1 and t.archived_at is null and c.role in ('HeadCoach', 'AsstCoach')";

// Most teams first, then by name.
export async function busyCoaches(q: Pick<Queryable, "query">, org: string, now: Date): Promise<BusyCoach[]> {
  const r = await q.query<{ coach_id: string; name: string; teams: { id: string; name: string }[] }>(
    `with x as (select distinct coach_id, team, name from (${TEAMS[org] ?? ORG_TEAMS}) y where $2::date is not null)
     select x.coach_id, u.first_name || ' ' || u.last_name as name,
            json_agg(json_build_object('id', x.team, 'name', x.name) order by lower(x.name)) as teams
       from x join users u on u.coach_id = x.coach_id
      group by x.coach_id, u.first_name, u.last_name
     having count(*) > ${MAX_TEAMS}
      order by count(*) desc, lower(u.last_name), lower(u.first_name)`,
    [org, easternDate(now)],
  );
  return r.rows.map((x) => ({ coachId: x.coach_id, name: x.name, teams: x.teams }));
}
