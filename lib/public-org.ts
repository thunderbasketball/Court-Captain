// An organization's public main page (its login link; SPEC.md section 14): what draws a visitor in. The banner's line,
// buttons and season numbers, the Leagues its gyms host, its gyms, and the coming games played at them. The same for every
// organization: what shows comes from what it has, never from which one it is. No login, so public details only: team
// names, counts, gyms and published games; no people.
import { directionsUrl } from "./directions";
import { shortDate } from "./program-options";
import { publicPrograms, type PublicLeagueSummary } from "./public-league";
import { PLACE_SQL } from "./scenic-games";
import { finalOf, type PublicFinal } from "./score-share";
import { gradeLabel, gradeRange } from "./scenic-teams";
import type { Queryable } from "./sql";
import { easternDate } from "./time";

type Q = Pick<Queryable, "query">;

// The current programs of the organizations its gyms host games for (hosting approved).
export async function hostedPrograms(q: Q, now: Date, org: string): Promise<PublicLeagueSummary[]> {
  const r = await q.query<{ for_org: string }>("select for_org from org_partnerships where host_org = $1 and status = 'approved'", [org]);
  const hosts = new Set(r.rows.map((x) => x.for_org));
  if (!hosts.size) return [];
  const today = easternDate(now);
  return (await publicPrograms(q, now)).filter((p) => p.kind === "League" && p.endsOn >= today && hosts.has(p.org));
}

export type PublicGym = { name: string; address: string | null; map: string | null };

// Its gyms, once it's approved to host another organization's games (none until then).
export async function hostGyms(q: Q, org: string): Promise<PublicGym[]> {
  const r = await q.query<{ name: string; address: string | null; lat: number | null; lng: number | null; place: string | null }>(
    `select g.name, coalesce(g.address, g.pin_address) as address, coalesce(g.pin_lat, g.lat) as lat, coalesce(g.pin_lng, g.lng) as lng,
            case when g.pin_lat is null then g.place_id end as place
       from gyms g
      where g.org = $1 and g.active and exists (select 1 from org_partnerships x where x.host_org = $1 and x.status = 'approved')
      order by lower(g.name)`,
    [org],
  );
  return r.rows.map((g) => ({ name: g.name, address: g.address, map: directionsUrl(g.lat, g.lng, g.place) }));
}

export type HostGame = { starts: string | null; gym: string | null; court: string | null; group: string; home: string; away: string; final: PublicFinal | null; hype: string | null }; // hype: its Game Day picture
export type HostDay = { date: string; games: HostGame[] };

// The coming day of published games at its gyms (any organization's League), by time; null when none.
export async function hostGames(q: Q, now: Date, org: string): Promise<HostDay | null> {
  const r = await q.query<{
    day: string;
    starts: string | null;
    gym: string | null;
    court: string | null;
    grade: number;
    gender: string;
    level: string;
    a: string;
    b: string;
    home_side: string | null;
    id: string;
    score_a: number | null;
    score_b: number | null;
    forfeit: "a" | "b" | null;
    scored_at: Date | null;
  }>(
    `with at as (
       select m.id, m.day from scenic_matchups m
         join gyms gy on gy.id = case when m.court_key ~ '^o[0-9]+' then split_part(substr(m.court_key, 2), '-', 1)::bigint end
        where gy.org = $1 and m.day >= $2::date and m.team_b is not null and scenic_game_published(m.program_id, m.day, m.team_a))
     select m.id::text, m.score_a, m.score_b, m.forfeit, m.scored_at, m.day::text as day, to_char(m.starts, 'HH24:MI') as starts, place.gym, place.court, g.grade, d.gender, g.level,
            ta.name as a, tb.name as b, m.home_side
       from at join scenic_matchups m on m.id = at.id
       join scenic_teams ta on ta.id = m.team_a join scenic_teams tb on tb.id = m.team_b
       join scenic_registrations r on r.program_id = m.program_id and r.team_id = m.team_a
       join scenic_pools po on po.id = r.pool_id join scenic_grade_groups g on g.id = po.group_id
       join scenic_divisions d on d.id = g.division_id
       ${PLACE_SQL}
      where m.day = (select min(day) from at) and ta.name not like '%(DEV)' and tb.name not like '%(DEV)'
      order by m.starts nulls last, lower(place.gym), lower(place.court), lower(ta.name)`,
    [org, easternDate(now)],
  );
  if (!r.rows.length) return null;
  return {
    date: r.rows[0].day,
    games: r.rows.map((m) => {
      const aHome = (m.home_side ?? "a") === "a";
      return {
        starts: m.starts,
        gym: m.gym,
        court: m.court,
        group: `${gradeLabel(m.grade, m.grade)} ${m.gender} ${m.level}`,
        home: aHome ? m.a : m.b,
        away: aHome ? m.b : m.a,
        final: finalOf(m, now),
        hype: m.starts && m.score_a === null && !m.forfeit ? m.id : null,
      };
    }),
  };
}

export type ProgramCounts = { teams: number; divisions: number; orgs: number };

// How big these programs are: teams, divisions with teams, and organizations (stand-alone teams aren't one).
export async function programCounts(q: Q, ids: string[]): Promise<ProgramCounts> {
  if (!ids.length) return { teams: 0, divisions: 0, orgs: 0 };
  const r = await q.query<ProgramCounts>(
    `select count(distinct t.id)::int as teams, count(distinct g.division_id)::int as divisions,
            count(distinct p.id) filter (where og.kind is distinct from 'Team')::int as orgs
       from scenic_registrations r join scenic_teams t on t.id = r.team_id
       join scenic_pools po on po.id = r.pool_id join scenic_grade_groups g on g.id = po.group_id
       left join partners p on p.id = t.partner_id left join organizations og on og.slug = p.org_slug
      where r.program_id = any($1::bigint[]) and r.removed_by is null and t.name not like '%(DEV)'`,
    [ids],
  );
  return r.rows[0];
}

// A program's divisions, boys first, youngest first ("Boys 4th–5th").
export async function programDivisions(q: Q, id: string): Promise<string[]> {
  const r = await q.query<{ gender: string; low: number; high: number }>(
    "select gender, grade_low as low, grade_high as high from scenic_divisions where program_id = $1 order by grade_low = -1 desc, gender, grade_low, grade_high",
    [id],
  );
  return r.rows.map((d) => `${d.gender} ${gradeRange(d.low, d.high)}`);
}

// Whole days from one date ("YYYY-MM-DD") to another.
export const daysUntil = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export type HeroInput = {
  org: string;
  today: string;
  own: { id: string; name: string; regCloses: string; startsOn: string; endsOn: string; register: boolean }[]; // its team programs
  seasons: { name: string; regCloses: string | null; startsOn: string | null }[]; // its player programs
  leagues: { name: string; orgName: string; startsOn: string }[]; // others' programs its teams are in, or its gyms host
  teams: number; // its teams in a current event
  counts: ProgramCounts; // its own programs'
  gyms: number;
  hosting: boolean; // its gyms host one of `leagues`
  players: boolean; // Find my player's team
  recruiting: boolean; // Apply to officiate
  openable: boolean; // a program or League here opens (its teams and standings)
};
export type Hero = { line: string; stats: { value: number; label: string }[]; actions: { label: string; href: string }[] };

const s = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

// Pure: the banner's line (the most inviting thing true today), its numbers (never a zero; four at most) and its buttons
// (three at most, the first one the main one).
export function heroFor(h: HeroInput): Hero {
  const open = h.own.filter((p) => p.register).sort((a, b) => a.regCloses.localeCompare(b.regCloses))[0];
  const season = h.seasons.find((p) => p.regCloses && p.regCloses >= h.today);
  const current = h.own.find((p) => p.endsOn >= h.today);
  const league = h.leagues[0];
  const line = open
    ? `${open.name} team registration is open through ${shortDate(open.regCloses)}.`
    : season
      ? `${season.name} registration is open through ${shortDate(season.regCloses!)}.`
      : current
        ? current.startsOn > h.today
          ? `${current.name} starts ${shortDate(current.startsOn)}.`
          : `${current.name} is under way.`
        : league && h.teams
          ? `${h.teams} ${s(h.teams, "team")} playing in ${league.orgName} ${league.name}.`
          : league && h.hosting
            ? `Home gym for ${league.orgName} ${league.name} games.`
            : h.recruiting
              ? "Now looking for officials. Apply right here."
              : "Programs, teams and schedules show here as they're posted.";
  const starts = [...h.own.map((p) => p.startsOn), ...h.leagues.map((p) => p.startsOn), ...h.seasons.flatMap((p) => p.startsOn ?? [])]
    .filter((d) => d > h.today)
    .sort()[0];
  const days = starts ? daysUntil(h.today, starts) : 0;
  const stats = [
    { value: days, label: s(days, "day to tip-off", "days to tip-off") },
    h.counts.teams ? { value: h.counts.teams, label: s(h.counts.teams, "team") } : { value: h.teams, label: s(h.teams, "team") },
    { value: h.counts.divisions, label: s(h.counts.divisions, "division") },
    { value: h.counts.orgs, label: s(h.counts.orgs, "organization") },
    { value: h.gyms, label: s(h.gyms, "gym") },
  ]
    .filter((x) => x.value > 0)
    .slice(0, 4);
  const actions = [
    ...(open ? [{ label: "Register a new team", href: `/register-team/${h.org}?program=${open.id}` }] : []),
    ...(h.players ? [{ label: "Find my player's team", href: "#parents" }] : []),
    ...(h.openable ? [{ label: "Teams & standings", href: "#programs" }] : []),
    ...(h.teams ? [{ label: "Our teams", href: "#teams" }] : []),
    ...(h.recruiting ? [{ label: "Become an official", href: "#officials" }] : []),
    ...(h.gyms ? [{ label: "Our gyms", href: "#gyms" }] : []),
  ].slice(0, 3);
  return { line, stats, actions };
}
