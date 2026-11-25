// Uniform numbers two players on a team share (SPEC.md section 15): allowed while they're sorted out, but warned to the team's
// coaches (team page, Teams card, Uniforms), its organization's staff (Teams flashing, Home's To Do, Warnings, the Uniforms
// card) and, for a team registered in a League, the League's staff (its Teams and To Do). From wherever the roster is kept.
import type { Queryable } from "./sql";
import { dupNumbers } from "./uniform-fields";

type Q = Pick<Queryable, "query">;
export type DuplicateTeam = { id: string; name: string; numbers: string[] };

const found = (rows: { id: string; name: string; numbers: (string | null)[] }[]): DuplicateTeam[] =>
  rows.flatMap((t) => {
    const numbers = dupNumbers(t.numbers);
    return numbers.length ? [{ id: t.id, name: t.name, numbers }] : [];
  });

// An organization's own teams (Thunder's, or a registered organization's).
export async function orgDuplicates(q: Q, org: string): Promise<DuplicateTeam[]> {
  const r = await q.query<{ id: string; name: string; numbers: (string | null)[] }>(
    org === "thunder"
      ? `select t.id::text, t.name, array_agg(u.number) as numbers from teams t join team_players p on p.team_id = t.id
           join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
          where u.number is not null group by t.id, t.name order by t.grade_sort, lower(t.name)`
      : `select t.id::text, t.name, array_agg(p.jersey) as numbers from org_teams t join org_team_players p on p.team_id = t.id
          where t.org = $1 and t.archived_at is null and p.jersey is not null group by t.id, t.name order by t.grade, lower(t.name)`,
    org === "thunder" ? [] : [org],
  );
  return found(r.rows);
}

// A League's teams (these ids, or every one registered in this organization's programs still going).
export async function leagueDuplicates(q: Q, which: { ids: string[] } | { org: string; today: string }): Promise<DuplicateTeam[]> {
  const byIds = "ids" in which;
  const r = await q.query<{ id: string; name: string; numbers: (string | null)[] }>(
    `with mine as (select t.id, t.name, t.thunder_team_id, t.org_team_id from scenic_teams t
       where t.name not like '%(DEV)' and ${
         byIds
           ? "t.id = any($1::bigint[])"
           : `exists (select 1 from scenic_registrations r join scenic_programs p on p.id = r.program_id
                       where r.team_id = t.id and r.removed_by is null and p.org = $1 and p.ends_on >= $2::date)`
       })
     select id::text, name, array_agg(n) as numbers from (
       select m.id, m.name, u.number as n from mine m join team_players p on p.team_id = m.thunder_team_id
         join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
       union all
       select m.id, m.name, p.jersey from mine m join org_team_players p on p.team_id = m.org_team_id
       union all
       select m.id, m.name, p.jersey from mine m join scenic_team_players p on p.team_id = m.id where m.thunder_team_id is null and m.org_team_id is null
     ) x where n is not null group by id, name order by lower(name)`,
    byIds ? [which.ids] : [which.org, which.today],
  );
  return found(r.rows);
}

export const dupLabel = (numbers: string[]) => numbers.map((n) => `#${n}`).join(", ");
