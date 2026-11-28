// How many of an organization's coaches are using the app (SPEC.md section 14): its Head and Assistant Coaches with an active login
// (a League: the coaches of the teams in its Leagues not ended) who logged in or opened a page in the last 7 days, in any
// organization. Views as someone else don't count (they aren't recorded as visits).
import type { Queryable } from "./sql";
import { easternDate } from "./time";

export const USE_DAYS = 7;
// `parts`: the same for each organization in the League (Scenic City), or each team (any other organization), fewest using first.
export type CoachUsePart = { name: string; using: number; total: number; percent: number };
export type CoachUse = { using: number; total: number; percent: number; by: "organization" | "team" | "grade"; parts: CoachUsePart[] };

// Each coach with the part they count in (a coach can count in several), and the team (its name) that puts them there.
export const COACHES: Record<string, string> = {
  thunder: "select s.coach_id, t.name as part, t.name as team, t.id::text as team_id from team_staff s join teams t on t.id = s.team_id where s.role in ('HeadCoach', 'AsstCoach')",
  "scenic-city": `select x.coach_id, coalesce(pa.name, 'Solo coaches') as part, t.name as team, t.id::text as team_id
      from scenic_registrations r join scenic_programs p on p.id = r.program_id and p.org = $1 and p.ends_on >= $3::date
      join scenic_teams t on t.id = r.team_id
      left join partners pa on pa.id = t.partner_id
      cross join lateral (
        select t.coach_id where t.org_team_id is null and t.thunder_team_id is null
        union select s.coach_id from team_staff s where s.team_id = t.thunder_team_id and s.role in ('HeadCoach', 'AsstCoach')
        union select c.coach_id from org_team_coaches c where c.team_id = t.org_team_id and c.role in ('HeadCoach', 'AsstCoach')
      ) x where r.removed_by is null`,
};
export const ORG_COACHES =
  "select c.coach_id, t.name as part, t.name as team, t.id::text as team_id from org_team_coaches c join org_teams t on t.id = c.team_id where t.org = $1 and t.archived_at is null and c.role in ('HeadCoach', 'AsstCoach')";
const pct = (using: number, total: number) => Math.round((using * 100) / total);

// Null when it has no coaches with logins.
export async function coachUse(q: Pick<Queryable, "query">, org: string, now: Date): Promise<CoachUse | null> {
  const r = await q.query<{ part: string | null; using: number; total: number }>(
    `with c as (${COACHES[org] ?? ORG_COACHES}),
          u as (select c.part, u.coach_id,
                       (u.last_login_at > $2::timestamptz - make_interval(days => ${USE_DAYS})
                        or exists (select 1 from site_visits v where v.coach_id = u.coach_id and v.hour > $2::timestamptz - make_interval(days => ${USE_DAYS}))) as on_app
                  from c join users u on u.coach_id = c.coach_id
                 where u.active and $1::text is not null and $3::date is not null)
     select part, count(distinct coach_id)::int as total, count(distinct coach_id) filter (where on_app)::int as using
       from u group by rollup (part)`,
    [org, now, easternDate(now)],
  );
  const all = r.rows.find((x) => x.part === null);
  if (!all?.total) return null;
  const parts = r.rows
    .filter((x) => x.part !== null)
    .map((x) => ({ name: x.part!, using: x.using, total: x.total, percent: pct(x.using, x.total) }))
    .sort((a, b) => a.percent - b.percent || b.total - a.total || a.name.localeCompare(b.name));
  return { using: all.using, total: all.total, percent: pct(all.using, all.total), by: org === "scenic-city" ? "organization" : "team", parts };
}
