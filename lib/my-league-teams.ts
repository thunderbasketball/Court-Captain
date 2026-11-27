// My teams on an organization's main page (SPEC.md section 14): the League teams of the person logged in, shown without
// following them. On an organization's page, its teams they're on: as a Head or Assistant Coach, Team Manager or Team
// Parent (Thunder's team staff; an organization's team coaches), or as a parent of a player on it (Thunder: their cell on
// the player's registration, and their email verified). On a CourtEvents organization's page (the League), every team of
// theirs in its current programs, from any organization. Only teams registered in a current League program; ids only (the
// page loads the same public details as for followed teams).
import type { Queryable } from "./sql";
import { easternDate } from "./time";

const MAX = 30;

export async function myLeagueTeams(q: Pick<Queryable, "query">, coachId: string, org: string, now: Date, league: boolean): Promise<string[]> {
  const r = await q.query<{ id: string }>(
    `with mine as (
       select t.id, 'thunder' as org from scenic_teams t join team_staff s on s.team_id = t.thunder_team_id where s.coach_id = $1
       union
       select t.id, 'thunder' from scenic_teams t join team_players p on p.team_id = t.thunder_team_id
         join registrations g on g.registrant_id = p.registrant_id join users u on u.coach_id = $1 and u.active
        where u.cell in (g.parent1_cell, g.parent2_cell) and u.email is not null and lower(trim(u.email)) = lower(trim(coalesce(u.verified_email, '')))
       union
       select t.id, ot.org from scenic_teams t join org_teams ot on ot.id = t.org_team_id join org_team_coaches c on c.team_id = ot.id where c.coach_id = $1
       union
       select t.id, 'scenic-city' from scenic_teams t where (t.coach_id = $1 or t.owner_coach_id = $1) and t.org_team_id is null and t.thunder_team_id is null
     )
     select distinct m.id::text from mine m
       join scenic_registrations r on r.team_id = m.id and r.removed_by is null
       join scenic_programs p on p.id = r.program_id and p.kind = 'League' and p.ends_on >= $3::date
      where ($4 and p.org = $2) or m.org = $2
      order by 1 limit ${MAX}`,
    [coachId, org, easternDate(now), league],
  );
  return r.rows.map((x) => x.id);
}
