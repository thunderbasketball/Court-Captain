// Site visits (SPEC.md section 14: Home metrics). Each page view on the website counts for the organization the page
// belongs to, per person per hour. View As and CourtCaptain staff aren't counted. Its Owners and Admins see them on
// Home: Today (per hour), This Week (Mon–Sun, per day), This Month (per day), This Year (per month), Eastern time.
import type { SessionUser } from "./auth/service";
import { isOrgAdmin } from "./org-admin";
import type { Queryable } from "./sql";
import { TZ, localParts } from "./time";
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
// One query (this year's visits, or from this week's Monday if earlier, per person per hour) counted here into the four
// ranges, in Eastern wall-clock time; it was eight slow ones.
export async function visitStats(deps: Deps, viewer: SessionUser, org: string): Promise<Record<VisitRange, VisitStats> | null> {
  if (!(await isOrgAdmin(deps.pool, viewer.coachId, org))) return null;
  const now = localParts(deps.now());
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const day = (offset: number) => new Date(Date.UTC(now.year, now.month - 1, now.day + offset));
  const today = ymd(day(0));
  const monday = day(-((now.weekday + 6) % 7));
  const yearStart = `${now.year}-01-01`;
  const from = ymd(monday) < yearStart ? ymd(monday) : yearStart;

  const r = await deps.pool.query<{ day: string; hour: number; coach_id: string; views: number; coach: boolean }>(
    `with c as (${COACHES.replaceAll("$5", "$1")})
     select to_char(v.hour at time zone $3, 'YYYY-MM-DD') as day, extract(hour from v.hour at time zone $3)::int as hour,
            v.coach_id, v.views, v.coach_id in (select coach_id from c) as coach
       from site_visits v where v.org = $1 and v.hour >= ($2::date)::timestamp at time zone $3`,
    [org, from, TZ],
  );

  // Each range: its bucket starts, and which bucket a visit falls in (or none).
  const weekDays = Array.from({ length: 7 }, (_, i) => ymd(new Date(monday.getTime() + i * 86_400_000)));
  const monthDays = Array.from({ length: new Date(Date.UTC(now.year, now.month, 0)).getUTCDate() }, (_, i) =>
    ymd(new Date(Date.UTC(now.year, now.month - 1, i + 1))),
  );
  const ranges: Record<VisitRange, { starts: string[]; bucket: (d: string, h: number) => string | null }> = {
    today: {
      starts: Array.from({ length: 24 }, (_, h) => `${today}T${pad(h)}:00`),
      bucket: (d, h) => (d === today ? `${d}T${pad(h)}:00` : null),
    },
    week: { starts: weekDays.map((d) => `${d}T00:00`), bucket: (d) => (weekDays.includes(d) ? `${d}T00:00` : null) },
    month: { starts: monthDays.map((d) => `${d}T00:00`), bucket: (d) => (d.slice(0, 7) === today.slice(0, 7) ? `${d}T00:00` : null) },
    year: {
      starts: Array.from({ length: 12 }, (_, m) => `${now.year}-${pad(m + 1)}-01T00:00`),
      bucket: (d) => (d.slice(0, 4) === String(now.year) ? `${d.slice(0, 7)}-01T00:00` : null),
    },
  };
  return Object.fromEntries(
    VISIT_RANGES.map(({ key }) => {
      const { starts, bucket } = ranges[key];
      const by = new Map(starts.map((start) => [start, { start, n: 0, coach: 0 }]));
      const people = new Set<string>();
      let views = 0;
      for (const v of r.rows) {
        const b = by.get(bucket(v.day, v.hour) ?? "");
        if (!b) continue;
        b.n += v.views;
        if (v.coach) b.coach += v.views;
        views += v.views;
        people.add(v.coach_id);
      }
      return [key, { views, people: people.size, buckets: [...by.values()] }];
    }),
  ) as Record<VisitRange, VisitStats>;
}
