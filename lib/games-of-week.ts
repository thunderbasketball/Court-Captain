// Games of the Week (SPEC.md section 13): on an organization's public page, the 5 best REC and 5 best COMP matchups of
// the coming Game Day in its current Leagues (published schedules only), with where and when, and each team's season
// record. How a game qualifies (also shown under the cards' ⓘ): both teams have played at least one scored game this
// season; ranked by their combined winning percentage, then how even the two records are, then games played, then their
// combined Power Index (never the grade itself). Before any scores (week 1), the cards say so.
import { directionsUrl } from "./directions";
import { publicPrograms } from "./public-league";
import { PLACE_SQL } from "./scenic-games";
import { gradeLabel } from "./scenic-teams";
import type { Queryable } from "./sql";
import { easternDate } from "./time";

export const GOTW_COUNT = 5;
export const GOTW_RULES = [
  "Both teams have played at least one game this season with a score entered.",
  "Ranked by the two teams' combined winning percentage (best first),",
  "then how even their records are (closer is better),",
  "then games played (more is better), then the two teams' combined Power Index (PI).",
  "The top 5 REC and top 5 COMP games of the coming Game Day.",
];

export type GotwTeam = { id: string; name: string; w: number; l: number; pi: number };
export type GotwGame = {
  day: string;
  starts: string | null; // "HH:MM" Eastern
  gym: string | null;
  court: string | null;
  map: string | null;
  group: string; // "5th Boys COMP"
  program: string;
  home: GotwTeam;
  away: GotwTeam;
};
export type GamesOfTheWeek = { day: string | null; rec: GotwGame[]; comp: GotwGame[] };

type Rec = { w: number; l: number };
const pct = (r: Rec) => (r.w + r.l ? r.w / (r.w + r.l) : 0);

// Pure: rank matchups (each team's record) and keep the best `count`; only games where both teams have played.
export function rankGames<T extends { home: GotwTeam; away: GotwTeam }>(games: T[], count = GOTW_COUNT): T[] {
  return games
    .filter((g) => g.home.w + g.home.l > 0 && g.away.w + g.away.l > 0)
    .map((g) => ({ g, sum: pct(g.home) + pct(g.away), gap: Math.abs(pct(g.home) - pct(g.away)), played: g.home.w + g.home.l + g.away.w + g.away.l }))
    .sort((a, b) => b.sum - a.sum || a.gap - b.gap || b.played - a.played || b.g.home.pi + b.g.away.pi - (a.g.home.pi + a.g.away.pi))
    .slice(0, count)
    .map((x) => x.g);
}

export async function gamesOfTheWeek(q: Pick<Queryable, "query">, now: Date, org: string): Promise<GamesOfTheWeek | null> {
  const today = easternDate(now);
  // Its current Leagues (none: no cards); their games once a schedule is published (until then: the cards, empty).
  const current = (await publicPrograms(q, now, org)).filter((p) => p.kind === "League" && p.endsOn >= today);
  if (!current.length) return null;
  const leagues = current.filter((p) => p.published);
  if (!leagues.length) return { day: null, rec: [], comp: [] };
  const ids = leagues.map((l) => l.id);
  // Each league's coming published Game Day (with games): the week's day is the earliest.
  const next = await q.query<{ day: string | null }>(
    `select min(m.day)::text as day from scenic_matchups m where m.program_id = any($1::bigint[]) and m.day >= $2::date
       and exists (select 1 from scenic_published_days pd where pd.program_id = m.program_id and pd.day = m.day)`,
    [ids, today],
  );
  const day = next.rows[0]?.day ?? null;
  if (!day) return { day: null, rec: [], comp: [] };
  // Season records so far: scored games before that day.
  const recs = await q.query<{ team: string; w: number; l: number }>(
    `select team, count(*) filter (where won)::int as w, count(*) filter (where not won)::int as l from (
       select team_a as team, score_a > score_b as won from scenic_matchups
        where program_id = any($1::bigint[]) and score_a is not null and score_a <> score_b and team_b is not null and day < $2::date
       union all
       select team_b, score_b > score_a from scenic_matchups
        where program_id = any($1::bigint[]) and score_a is not null and score_a <> score_b and team_b is not null and day < $2::date
     ) x group by team`,
    [ids, day],
  );
  const recOf = new Map(recs.rows.map((r) => [String(r.team), { w: r.w, l: r.l }]));
  const pis = await q.query<{ team: string; pi: number }>("select team_id::text as team, pi from scenic_pi where program_id = any($1::bigint[])", [ids]);
  const piOf = new Map(pis.rows.map((r) => [r.team, r.pi]));
  const games = await q.query<{
    program: string;
    starts: string | null;
    gym: string | null;
    court: string | null;
    map_lat: number | null;
    map_lng: number | null;
    map_place: string | null;
    grade: number;
    gender: string;
    level: string;
    a_id: string;
    a: string;
    b_id: string;
    b: string;
    home_side: string | null;
  }>(
    `select p.name as program, to_char(m.starts, 'HH24:MI') as starts, place.gym, place.court, place.map_lat, place.map_lng, place.map_place,
            g.grade, d.gender, g.level, ta.id::text as a_id, ta.name as a, tb.id::text as b_id, tb.name as b, m.home_side
       from scenic_matchups m join scenic_programs p on p.id = m.program_id
       join scenic_teams ta on ta.id = m.team_a join scenic_teams tb on tb.id = m.team_b
       join scenic_registrations r on r.program_id = m.program_id and r.team_id = m.team_a
       join scenic_pools po on po.id = r.pool_id join scenic_grade_groups g on g.id = po.group_id
       join scenic_divisions d on d.id = g.division_id
       ${PLACE_SQL}
      where m.program_id = any($1::bigint[]) and m.day = $2::date
        and exists (select 1 from scenic_published_days pd where pd.program_id = m.program_id and pd.day = m.day) and ta.name not like '%(DEV)' and tb.name not like '%(DEV)'`,
    [ids, day],
  );
  const all = games.rows.map((m) => {
    const t = (id: string, name: string): GotwTeam => ({ id, name, ...(recOf.get(id) ?? { w: 0, l: 0 }), pi: piOf.get(id) ?? 500 });
    const aHome = (m.home_side ?? "a") === "a";
    const a = t(m.a_id, m.a);
    const b = t(m.b_id, m.b);
    return {
      day,
      starts: m.starts,
      gym: m.gym,
      court: m.court,
      map: directionsUrl(m.map_lat, m.map_lng, m.map_place),
      group: `${gradeLabel(m.grade, m.grade)} ${m.gender} ${m.level}`,
      program: m.program,
      home: aHome ? a : b,
      away: aHome ? b : a,
      grade: m.grade,
      level: m.level,
    };
  });
  const strip = (g: (typeof all)[number]): GotwGame => ({
    day: g.day, starts: g.starts, gym: g.gym, court: g.court, map: g.map, group: g.group, program: g.program, home: g.home, away: g.away,
  });
  return {
    day,
    rec: rankGames(all.filter((g) => g.level !== "COMP")).map(strip),
    comp: rankGames(all.filter((g) => g.level === "COMP")).map(strip),
  };
}
