// The Director's tabs that flash red (AppHeader): Teams while any Thunder team has an alert (a player not eligible by the
// grade requirements, no Head Coach, a coach's cell or email missing, or no players), Uniforms while any rostered
// player still needs a number or size (as lib/uniforms.ts uniformsMissing, across every team).
import type { Queryable } from "./sql";
import { memo } from "./request-memo";
import { rosterIssue, schoolYearOf } from "./eligibility";
import { orgGradeRules } from "./grade-rules";
import { easternDate } from "./time";

// Read once per page (the header and Home both ask; lib/request-memo.ts).
export function directorAlerts(q: Pick<Queryable, "query">, now: Date): Promise<{ teams: boolean; uniforms: boolean }> {
  return memo(q, "director-alerts", () => readDirectorAlerts(q, now));
}
async function readDirectorAlerts(q: Pick<Queryable, "query">, now: Date): Promise<{ teams: boolean; uniforms: boolean }> {
  const [teams, uniforms, { rules }] = await Promise.all([
    q.query<{ grades: string[]; missing: boolean; players: { grade: string; birthdate: string | null }[] }>(
      `select t.grades,
              (not exists (select 1 from team_staff s where s.team_id = t.id and s.role = 'HeadCoach') -- no Head Coach (or only named)
               or t.coach_first is not null
               or exists (select 1 from team_staff s join users u on u.coach_id = s.coach_id
                           where s.team_id = t.id and s.role = 'HeadCoach' and coalesce(trim(u.email), '') = '')
               or not exists (select 1 from team_players p where p.team_id = t.id)) as missing,
              coalesce((select json_agg(json_build_object('grade', p.grade, 'birthdate', to_char(g.birthdate, 'YYYY-MM-DD')))
                        from team_players p left join registrations g on g.registrant_id = p.registrant_id
                        where p.team_id = t.id), '[]') as players
       from teams t`,
    ),
    q.query<{ n: boolean }>(
      `select exists (select 1 from team_players p
                       left join registrations g on g.registrant_id = p.registrant_id
                       left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
                       where u.number is null
                          or ((coalesce(g.uniform_needed, false) or u.needs_uniform_at is not null) and u.size is null)) as n`,
    ),
    orgGradeRules(q, "thunder", now),
  ]);
  const year = schoolYearOf(easternDate(now));
  return {
    teams: teams.rows.some((t) => t.missing || !!rosterIssue(t.grades, t.players, year, rules)),
    uniforms: uniforms.rows[0].n,
  };
}
