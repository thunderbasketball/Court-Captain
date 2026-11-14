// An organization's Home metrics (SPEC.md section 14), for its Owners and Admins: players registered (with a daily
// trend), teams, players not on a team, teams missing a Head Coach or players, uniform prep, practice slots, coaches'
// use of the app (last login, longest ago first) and what's waiting on them. Only what the organization's features
// have. Thunder's come from its registrations and teams; another organization's from its own teams.
import { memo } from "./request-memo";
import type { SessionUser } from "./auth/service";
import { orgFeatures } from "./features";
import { ordinal } from "./grades";
import { isOrgAdmin } from "./org-admin";
import type { Queryable } from "./sql";
import { TZ, easternDate, weekOf } from "./time";
import { feeTrend, type FeeDay, type FeeRow } from "./fee-trend";

type Deps = { pool: Pick<Queryable, "query">; now: () => Date };

export const TREND_DAYS = 30;

export type OrgMetrics = {
  registrations: {
    total: number;
    thisWeek: number; // the last 7 days
    daily: { day: string; n: number }[]; // the last TREND_DAYS days, oldest first ("2026-11-03")
    syncedAt: Date | null;
    fees: FeeDay[]; // fees paid and owed to date, each day from the first payment to today
    span: { day: string; n: number }[]; // registrations each day, from the first registration to the last
  } | null;
  teams: { total: number; rec: number; comp: number; boys: number; girls: number } | null; // with Team Management
  notOnTeam: {
    total: number;
    groups: { label: string; n: number }[]; // "5th Boys"
    players: { id: string; name: string; gender: string; grade: string }[]; // by grade, gender, last name
  } | null;
  // by name. noCell: a Head Coach named without a cell yet; noEmail: a Head Coach without an email.
  missing: { id: string; name: string; noCoach: boolean; noCell: boolean; noEmail: boolean; noPlayers: boolean }[];
  uniforms: {
    players: number;
    ready: number;
    missing: number;
    // Each player still needing a number or size: Boys then Girls, by grade, team, last name.
    list: { gender: string; grade: number; team: string; teamId: string; name: string; noNumber: boolean; noSize: boolean }[];
  } | null;
  practices: {
    thisWeek: { booked: number; open: number };
    nextWeek: { booked: number; open: number };
    blackoutDays: number;
  } | null;
  coaches: { id: string; name: string; teams: string[]; lastLogin: Date | null }[]; // never first, then longest ago
  // Each team's use of the app: its staff's page views in the last 30 days and their last visit (least used first).
  teamUse: { id: string; name: string; views: number; lastVisit: Date | null }[];
  waiting: { requests: number; newChats: number; workingChats: number };
};

const count = async (q: Pick<Queryable, "query">, sql: string, params: unknown[] = []) =>
  (await q.query<{ n: number }>(sql, params)).rows[0].n;

export async function orgMetrics(deps: Deps, viewer: SessionUser, org: string): Promise<OrgMetrics | null> {
  if (!(await isOrgAdmin(deps.pool, viewer.coachId, org))) return null;
  const q = deps.pool;
  const now = deps.now();
  const has = await orgFeatures(q, org);
  const thunder = org === "thunder";
  const teamsOn = has.has("team-building");
  const [registrations, teams, notOnTeam, missing, uniforms, practices, coaches, waiting, teamUse] = await Promise.all([
    thunder && has.has("player-registration") ? registrationMetrics(q, now) : null,
    teamsOn ? teamCounts(q, org) : null,
    thunder && has.has("player-registration") ? notOnTeamMetrics(q) : null,
    teamsOn ? missingTeams(q, org) : [],
    thunder && has.has("uniforms") ? uniformMetrics(q) : null,
    thunder && has.has("practice") ? practiceMetrics(q, now) : null,
    teamsOn ? coachLogins(q, org) : [],
    waitingOn(q, org),
    teamsOn ? teamUsage(q, org, now) : [],
  ]);
  return { registrations, teams, notOnTeam, missing, uniforms, practices, coaches, waiting, teamUse };
}

async function registrationMetrics(q: Pick<Queryable, "query">, now: Date): Promise<OrgMetrics["registrations"]> {
  const [total, thisWeek, days, sync, fees, span] = await Promise.all([
    count(q, "select count(*)::int as n from registrations"),
    count(q, "select count(*)::int as n from registrations where registered_at > $1::timestamptz - interval '7 days'", [now]),
    // Each of the last 30 days in Eastern time, including days with none.
    q.query<{ day: string; n: number }>(
      `select to_char(d, 'YYYY-MM-DD') as day,
              (select count(*)::int from registrations r where (r.registered_at at time zone $2)::date = d) as n
       from generate_series(($1::timestamptz at time zone $2)::date - ($3::int - 1), ($1::timestamptz at time zone $2)::date, interval '1 day') d
       order by d`,
      [now, TZ, TREND_DAYS],
    ),
    q.query<{ at: Date | null }>("select max(checked_at) as at from sync_status where ok"),
    q.query<FeeRow>(
      `select to_char((registered_at at time zone $1)::date, 'YYYY-MM-DD') as "registeredOn",
              coalesce(amount_paid, 0)::float8 as paid, coalesce(amount_remaining, 0)::float8 as remaining,
              array[raw->>'1st Payment', raw->>'2nd Payment', raw->>'3rd Payment'] as installments
         from registrations where registered_at is not null`,
      [TZ],
    ),
    // Each day from the first registration to the last (Eastern), including days with none.
    q.query<{ day: string; n: number }>(
      `with r as (select (registered_at at time zone $1)::date as d from registrations where registered_at is not null)
       select to_char(g, 'YYYY-MM-DD') as day, (select count(*)::int from r where r.d = g::date) as n
       from generate_series((select min(d) from r), (select max(d) from r), interval '1 day') g order by g`,
      [TZ],
    ),
  ]);
  return {
    total,
    thisWeek,
    daily: days.rows,
    syncedAt: sync.rows[0]?.at ?? null,
    fees: feeTrend(fees.rows, easternDate(now)),
    span: span.rows,
  };
}

async function teamCounts(q: Pick<Queryable, "query">, org: string): Promise<OrgMetrics["teams"]> {
  const r = await q.query<NonNullable<OrgMetrics["teams"]>>(
    `select count(*)::int as total, count(*) filter (where level = 'REC')::int as rec, count(*) filter (where level = 'COMP')::int as comp,
            count(*) filter (where gender = 'Boys')::int as boys, count(*) filter (where gender = 'Girls')::int as girls
     from ${org === "thunder" ? "teams" : "org_teams where org = $1"}`,
    org === "thunder" ? [] : [org],
  );
  return r.rows[0];
}

// Registered players on no team, by grade then gender ("K Boys", "5th Girls").
async function notOnTeamMetrics(q: Pick<Queryable, "query">): Promise<OrgMetrics["notOnTeam"]> {
  const r = await q.query<{ grade: string; gender: string; n: number }>(
    `select r.grade, r.gender, count(*)::int as n from registrations r
     where not exists (select 1 from team_players p where p.registrant_id = r.registrant_id)
     group by r.grade, r.gender, r.grade_sort order by r.grade_sort, r.gender`,
  );
  const groups = r.rows.map((g) => ({ label: `${ordinal(g.grade)} ${g.gender}`, n: g.n }));
  const players = await q.query<{ id: string; name: string; gender: string; grade: string }>(
    `select r.registrant_id as id, r.first_name || ' ' || r.last_name as name, r.gender, r.grade from registrations r
     where not exists (select 1 from team_players p where p.registrant_id = r.registrant_id)
     order by r.grade_sort, r.gender, lower(r.last_name), lower(r.first_name)`,
  );
  return { total: groups.reduce((a, g) => a + g.n, 0), groups, players: players.rows };
}

async function missingTeams(q: Pick<Queryable, "query">, org: string): Promise<OrgMetrics["missing"]> {
  const [teams, staff, players] =
    org === "thunder"
      ? ["teams t", "team_staff s where s.team_id = t.id", "team_players p where p.team_id = t.id"]
      : ["org_teams t", "org_team_coaches s where s.team_id = t.id", "org_team_players p where p.team_id = t.id"];
  const r = await q.query<OrgMetrics["missing"][number]>(
    `select t.id::text, t.name,
            t.coach_first is null and not exists (select 1 from ${staff} and s.role = 'HeadCoach') as "noCoach",
            t.coach_first is not null as "noCell",
            exists (select 1 from ${staff} and s.role = 'HeadCoach'
                    and exists (select 1 from users u where u.coach_id = s.coach_id and u.email is null)) as "noEmail",
            not exists (select 1 from ${players}) as "noPlayers"
     from ${teams} ${org === "thunder" ? "" : "where t.org = $1"}`,
    org === "thunder" ? [] : [org],
  );
  return r.rows
    .filter((t) => t.noCoach || t.noCell || t.noEmail || t.noPlayers)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// Rostered players with a number, and a size when they need a uniform (ordered, or ticked by their coach) (as the Uniforms page counts them).
async function uniformMetrics(q: Pick<Queryable, "query">): Promise<OrgMetrics["uniforms"]> {
  const r = await q.query<{ players: number; missing: number }>(
    `select count(*)::int as players,
            count(*) filter (where u.number is null
                             or ((coalesce(g.uniform_needed, false) or u.needs_uniform_at is not null) and u.size is null))::int as missing
     from team_players p
     left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
     left join registrations g on g.registrant_id = p.registrant_id`,
  );
  const { players, missing } = r.rows[0];
  const list = await q.query<NonNullable<OrgMetrics["uniforms"]>["list"][number]>(
    `select t.gender, t.grade_sort as grade, t.name as team, t.id::text as "teamId", g.first_name || ' ' || g.last_name as name,
            u.number is null as "noNumber",
            ((coalesce(g.uniform_needed, false) or u.needs_uniform_at is not null) and u.size is null) as "noSize"
     from team_players p
     join teams t on t.id = p.team_id
     join registrations g on g.registrant_id = p.registrant_id
     left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
     where u.number is null or ((coalesce(g.uniform_needed, false) or u.needs_uniform_at is not null) and u.size is null)
     order by t.gender, t.grade_sort, lower(t.name), lower(g.last_name), lower(g.first_name)`,
  );
  return { players, missing, ready: players - missing, list: list.rows };
}

// Practice slots booked and open this week and next (blacked-out slots aren't open), and blackout days in the next 30.
// Read once per page (Home's metrics and the Practice card's title both ask; lib/request-memo.ts).
export function practiceMetrics(q: Pick<Queryable, "query">, now: Date): Promise<OrgMetrics["practices"]> {
  return memo(q, "practice-metrics", () => readPracticeMetrics(q, now));
}
async function readPracticeMetrics(q: Pick<Queryable, "query">, now: Date): Promise<OrgMetrics["practices"]> {
  const week = (start: Date, end: Date) =>
    q
      .query<{ booked: number; open: number }>(
        `select count(*) filter (where team_id is not null)::int as booked,
                count(*) filter (where team_id is null and not blackout and starts_at > $3)::int as open
         from slots where starts_at >= $1 and starts_at < $2`,
        [start, end, now],
      )
      .then((r) => r.rows[0]);
  const w = weekOf(now);
  const next = weekOf(new Date(w.end.getTime() + 60 * 60 * 1000));
  const [thisWeek, nextWeek, blackoutDays] = await Promise.all([
    week(w.start, w.end),
    week(next.start, next.end),
    count(
      q,
      `select count(distinct day)::int as n from blackouts
       where day >= ($1::timestamptz at time zone $2)::date and day < ($1::timestamptz at time zone $2)::date + 30`,
      [now, TZ],
    ),
  ]);
  return { thisWeek, nextWeek, blackoutDays };
}

// Head and Assistant Coaches, with their teams and last login: never logged in first, then longest ago.
async function coachLogins(q: Pick<Queryable, "query">, org: string): Promise<OrgMetrics["coaches"]> {
  const staff =
    org === "thunder"
      ? `select s.coach_id, t.name from team_staff s join teams t on t.id = s.team_id where s.role in ('HeadCoach', 'AsstCoach')`
      : `select c.coach_id, t.name from org_team_coaches c join org_teams t on t.id = c.team_id where t.org = $1`;
  const r = await q.query<OrgMetrics["coaches"][number]>(
    `select u.coach_id as id, u.first_name || ' ' || u.last_name as name, array_agg(x.name order by x.name) as teams,
            u.last_login_at as "lastLogin"
     from (${staff}) x join users u on u.coach_id = x.coach_id
     where u.active
     group by u.coach_id
     order by u.last_login_at asc nulls first, lower(u.last_name), lower(u.first_name)`,
    org === "thunder" ? [] : [org],
  );
  return r.rows;
}

// Join requests (people waiting to be let in) and Support chats started in this organization.
async function waitingOn(q: Pick<Queryable, "query">, org: string): Promise<OrgMetrics["waiting"]> {
  const [requests, chats] = await Promise.all([
    count(
      q,
      `select count(*)::int as n from users u where u.active and has_role(u.coach_id, $1, 'Request')
         and not has_role(u.coach_id, $1, 'Coach') and not has_role(u.coach_id, $1, 'Director')
         and not ($1 = 'thunder' and exists (select 1 from team_staff s where s.coach_id = u.coach_id))`,
      [org],
    ),
    q.query<{ status: string; n: number }>(
      "select status, count(*)::int as n from support_questions where org = $1 and status in ('new', 'working') group by status",
      [org],
    ),
  ]);
  const chat = (s: string) => chats.rows.find((c) => c.status === s)?.n ?? 0;
  return { requests, newChats: chat("new"), workingChats: chat("working") };
}

// Each team's use of the app: page views by its staff (Thunder: Head and Assistant Coaches, Managers, Team Parents;
// another organization: its coaches) in the last 30 days, and their latest visit. Least used first.
async function teamUsage(q: Pick<Queryable, "query">, org: string, now: Date): Promise<OrgMetrics["teamUse"]> {
  const staff =
    org === "thunder"
      ? "select t.id, t.name, s.coach_id from teams t left join team_staff s on s.team_id = t.id"
      : "select t.id, t.name, c.coach_id from org_teams t left join org_team_coaches c on c.team_id = t.id where t.org = $2";
  const r = await q.query<OrgMetrics["teamUse"][number]>(
    `select x.id::text, x.name,
            coalesce(sum(v.views) filter (where v.hour >= $1::timestamptz - interval '30 days'), 0)::int as views,
            max(v.hour) as "lastVisit"
     from (${staff}) x
     left join site_visits v on v.coach_id = x.coach_id and v.org = $2
     group by x.id, x.name
     order by 3, max(v.hour) asc nulls first, lower(x.name)`,
    [now, org],
  );
  return r.rows;
}
