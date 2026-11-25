// How many of an organization's coaches are using the app (SPEC.md section 14): its Head and Assistant Coaches with an active login
// (a League: the coaches of the teams in its Leagues not ended) who logged in or opened a page in the last 7 days, in any
// organization. Views as someone else don't count (they aren't recorded as visits).
import type { Queryable } from "./sql";
import { easternDate } from "./time";

export const USE_DAYS = 7;
export type CoachUse = { using: number; total: number; percent: number };

const COACHES: Record<string, string> = {
  thunder: "select coach_id from team_staff where role in ('HeadCoach', 'AsstCoach')",
  "scenic-city": `select x.coach_id from scenic_registrations r join scenic_programs p on p.id = r.program_id and p.org = $1 and p.ends_on >= $3::date
      join scenic_teams t on t.id = r.team_id
      cross join lateral (
        select t.coach_id where t.org_team_id is null and t.thunder_team_id is null
        union select s.coach_id from team_staff s where s.team_id = t.thunder_team_id and s.role in ('HeadCoach', 'AsstCoach')
        union select c.coach_id from org_team_coaches c where c.team_id = t.org_team_id and c.role in ('HeadCoach', 'AsstCoach')
      ) x where r.removed_by is null`,
};
const ORG_COACHES = "select c.coach_id from org_team_coaches c join org_teams t on t.id = c.team_id where t.org = $1 and t.archived_at is null and c.role in ('HeadCoach', 'AsstCoach')";

// Null when it has no coaches with logins.
export async function coachUse(q: Pick<Queryable, "query">, org: string, now: Date): Promise<CoachUse | null> {
  const r = await q.query<{ using: number; total: number }>(
    `select count(*)::int as total,
            count(*) filter (where u.last_login_at > $2::timestamptz - make_interval(days => ${USE_DAYS})
                                or exists (select 1 from site_visits v where v.coach_id = u.coach_id and v.hour > $2::timestamptz - make_interval(days => ${USE_DAYS})))::int as using
       from users u where u.active and u.coach_id in (${COACHES[org] ?? ORG_COACHES}) and $1::text is not null and $3::date is not null`,
    [org, now, easternDate(now)],
  );
  const { using, total } = r.rows[0];
  return total ? { using, total, percent: Math.round((using * 100) / total) } : null;
}
