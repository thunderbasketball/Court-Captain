// Find your team (no login; SPEC.md section 13): on the League's Register, so someone whose team is already in it finds it
// instead of registering it again. They type a coach's last name (or a team's name); they get teams, never coaches' names or
// contacts. Teams in the organization's current programs; simulated teams and teams sitting out are left out.
import { publicPrograms } from "./public-league";
import { gradeLabel } from "./scenic-teams";
import type { Queryable } from "./sql";
import { easternDate } from "./time";

export type FoundTeam = { id: string; name: string; group: string; org: string | null; orgSlug: string | null };
export type Findable = FoundTeam & { lasts: string[] }; // its coaches' last names: matched on the server only
export const MAX_FOUND = 12;

const NOT_DEV = "t.name not like '%(DEV)'";

export async function findableTeams(q: Pick<Queryable, "query">, now: Date, org: string): Promise<Findable[]> {
  const today = easternDate(now);
  const ids = (await publicPrograms(q, now, org)).filter((p) => p.endsOn >= today).map((p) => p.id);
  if (!ids.length) return [];
  const r = await q.query<{ id: string; name: string; grade: number; gender: string; level: string; org: string | null; slug: string | null; lasts: (string | null)[] }>(
    `select distinct on (t.id) t.id::text, t.name, g.grade, d.gender, g.level, case when og.kind = 'Team' then null else coalesce(og.name, p.name) end as org,
            case when og.kind = 'Team' then null else og.slug end as slug,
            array(select u.last_name from users u where u.coach_id = t.coach_id
                  union select u.last_name from scenic_team_staff s join users u on u.coach_id = s.coach_id where s.team_id = t.id and s.role in ('HeadCoach', 'AsstCoach')
                  union select u.last_name from org_team_coaches c join users u on u.coach_id = c.coach_id where c.team_id = t.org_team_id and c.role in ('HeadCoach', 'AsstCoach')
                  union select u.last_name from team_staff s join users u on u.coach_id = s.coach_id where s.team_id = t.thunder_team_id and s.role in ('HeadCoach', 'AsstCoach')
                  union select t.coach_last
                  union select x.coach_last from org_teams x where x.id = t.org_team_id
                  union select x.coach_last from teams x where x.id = t.thunder_team_id) as lasts
       from scenic_registrations r join scenic_teams t on t.id = r.team_id
       join scenic_pools po on po.id = r.pool_id join scenic_grade_groups g on g.id = po.group_id join scenic_divisions d on d.id = g.division_id
       left join partners p on p.id = t.partner_id left join organizations og on og.slug = p.org_slug
      where r.program_id = any($1::bigint[]) and r.removed_by is null and ${NOT_DEV}
      order by t.id, r.program_id`,
    [ids],
  );
  return r.rows.map((t) => ({
    id: t.id,
    name: t.name,
    group: `${gradeLabel(t.grade, t.grade)} ${t.gender} ${t.level}`,
    org: t.org,
    orgSlug: t.slug,
    lasts: t.lasts.filter((x): x is string => !!x),
  }));
}

const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ'’.]/g, "").toLowerCase();

// Pure: teams with a coach whose last name starts with what's typed, then teams with it in their name; by name. Nothing for
// fewer than 2 letters.
export function searchTeams(teams: Findable[], typed: unknown): FoundTeam[] {
  const text = typeof typed === "string" ? plain(typed).trim().slice(0, 40) : "";
  const words = text.split(/\s+/).filter(Boolean);
  if (text.replace(/[^a-z0-9]/g, "").length < 2) return [];
  const byCoach = (t: Findable) => t.lasts.some((l) => plain(l).startsWith(text) || plain(l).split(/[\s-]+/).some((x) => x.startsWith(text)));
  const byName = (t: Findable) => words.every((w) => plain(t.name).split(/\s+/).some((x) => x.startsWith(w)));
  const sort = (a: Findable, b: Findable) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const coach = teams.filter(byCoach).sort(sort);
  const rest = teams.filter((t) => !byCoach(t) && byName(t)).sort(sort);
  return [...coach, ...rest].slice(0, MAX_FOUND).map(({ id, name, group, org, orgSlug }) => ({ id, name, group, org, orgSlug }));
}
