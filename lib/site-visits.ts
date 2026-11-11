// Site visits (SPEC.md section 14: Home metrics). Each page view on the website counts for the organization the page
// belongs to, per person per hour. View As and CourtCaptain staff aren't counted. Its Owners and Admins see them on
// Home: Today (per hour), This Week (Mon–Sun, per day), This Month (per day), This Year (per month), Eastern time.
import type { SessionUser } from "./auth/service";
import { isOrgAdmin } from "./org-admin";
import type { Queryable } from "./sql";
import { TZ } from "./time";
import { VISIT_RANGES, type VisitRange } from "./visit-ranges";

export { VISIT_RANGES, type VisitRange };

type Deps = { pool: Pick<Queryable, "query">; now: () => Date };

export async function recordVisit(deps: Deps, viewer: SessionUser, org: string) {
  if (viewer.actingBy) return;
  await deps.pool.query(
    `insert into site_visits (org, hour, coach_id) select $1, date_trunc('hour', $3::timestamptz), $2
     where exists (select 1 from organizations where slug = $1)
       and not exists (select 1 from platform_admins where coach_id = $2)
     on conflict (org, hour, coach_id) do update set views = site_visits.views + 1`,
    [org, viewer.coachId, deps.now()],
  );
}

// `start` is Eastern wall-clock time ("2026-11-03T14:00"); future buckets count 0.
// coach: of each bucket's views, those by the organization's coaches (its teams' Head and Assistant Coaches).
// The organization's coaches: Thunder's teams' Head and Assistant Coaches, or another organization's team coaches.
const COACHES = `select s.coach_id from team_staff s where $5 = 'thunder' and s.role in ('HeadCoach', 'AsstCoach')
                 union select c.coach_id from org_team_coaches c join org_teams t on t.id = c.team_id where t.org = $5`;

export type VisitStats = { views: number; people: number; buckets: { start: string; n: number; coach: number }[] };

// Owners and Admins only (null otherwise): page views and different people in each range, with the views per bucket.
export async function visitStats(deps: Deps, viewer: SessionUser, org: string): Promise<Record<VisitRange, VisitStats> | null> {
  if (!(await isOrgAdmin(deps.pool, viewer.coachId, org))) return null;
  const now = deps.now();
  const all = await Promise.all(
    VISIT_RANGES.map(async ({ period, step }) => {
      // p.s: the range's first moment, Eastern wall-clock time.
      const [buckets, totals] = await Promise.all([
        deps.pool.query<{ start: string; n: number; coach: number }>(
          `with p as (select date_trunc($2, $1::timestamptz at time zone $4) as s),
                b as (select g from p, generate_series(p.s, p.s + ('1 ' || $2)::interval - ('1 ' || $3)::interval, ('1 ' || $3)::interval) g),
                c as (${COACHES})
           select to_char(b.g, 'YYYY-MM-DD"T"HH24:MI') as start, coalesce(sum(v.views), 0)::int as n,
                  coalesce(sum(v.views) filter (where v.coach_id in (select coach_id from c)), 0)::int as coach
           from b left join site_visits v on v.org = $5 and date_trunc($3, v.hour at time zone $4) = b.g
             and v.hour >= (select s from p) at time zone $4
           group by b.g order by b.g`,
          [now, period, step, TZ, org],
        ),
        deps.pool.query<{ views: number; people: number }>(
          `with p as (select date_trunc($2, $1::timestamptz at time zone $3) as s)
           select coalesce(sum(views), 0)::int as views, count(distinct coach_id)::int as people from site_visits, p
           where org = $4 and hour >= p.s at time zone $3 and hour < (p.s + ('1 ' || $2)::interval) at time zone $3`,
          [now, period, TZ, org],
        ),
      ]);
      return { ...totals.rows[0], buckets: buckets.rows };
    }),
  );
  return Object.fromEntries(VISIT_RANGES.map((r, i) => [r.key, all[i]])) as Record<VisitRange, VisitStats>;
}
