// Games of the Week (SPEC.md section 13): on an organization's public page, in two versions by the day of the week:
// - Upcoming Game Highlights (Tuesday until noon on Game Day): the 5 best REC and 5 best COMP matchups of the coming Game
//   Day in its current Leagues (published schedules only), with where and when, and each team's season record.
// - Game Recaps (noon on Game Day through Monday): that Game Day's highlighted games with their final scores; while fewer
//   than 5 qualify (week 1), the closest finals fill in. How a game qualifies (also shown under the cards' ⓘ): both teams have played at least one scored game this
// season; ranked by their combined winning percentage, then how even the two records are, then games played, then their
// combined Power Index (never the grade itself). Before any scores (week 1), the cards say so.
import { directionsUrl } from "./directions";
import { publicPrograms } from "./public-league";
import { PLACE_SQL } from "./scenic-games";
import { gradeLabel } from "./scenic-teams";
import type { Queryable } from "./sql";
import { easternDate, localParts } from "./time";
import { addDays } from "./schedule-request-blocks";

export const GOTW_COUNT = 5;
export { GOTW_RULES, RECAP_RULES } from "./games-of-week-rules";

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
  final?: { home: number | null; away: number | null; forfeit: "home" | "away" | null } | null; // recaps: once scored
};
// mode: "upcoming" (Upcoming Game Highlights) or "recap" (Game Recaps, of `day`).
export type GamesOfTheWeek = { mode: "upcoming" | "recap"; day: string | null; rec: GotwGame[]; comp: GotwGame[] };

// Pure: recaps run from noon (Eastern) on a Game Day until the Tuesday after it.
export function inRecap(lastDay: string | null, today: string, hour: number): boolean {
  if (!lastDay || today < lastDay) return false;
  if (today === lastDay) return hour >= 12;
  const dow = new Date(`${lastDay}T12:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  const tuesday = addDays(lastDay, ((2 - dow + 7) % 7) || 7);
  return today < tuesday;
}

// Pure: a recap's games: the highlighted ones (as ranked before the day), then the closest finals, up to `count`; scored only.
export function recapGames<T extends { home: GotwTeam; away: GotwTeam; final?: GotwGame["final"] }>(games: T[], count = GOTW_COUNT): T[] {
  const scored = games.filter((g) => g.final);
  const top = rankGames(scored, count);
  const margin = (g: T) => (g.final!.forfeit ? 999 : Math.abs((g.final!.home ?? 0) - (g.final!.away ?? 0)));
  const rest = scored.filter((g) => !top.includes(g)).sort((a, b) => margin(a) - margin(b));
  return [...top, ...rest].slice(0, count);
}

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
  if (!leagues.length) return { mode: "upcoming", day: null, rec: [], comp: [] };
  const ids = leagues.map((l) => l.id);
  // The latest published Game Day so far (for recaps) and the coming one (for highlights).
  const days = await q.query<{ last: string | null; next: string | null }>(
    `select max(m.day) filter (where m.day <= $2::date)::text as last, min(m.day) filter (where m.day >= $2::date)::text as next
       from scenic_matchups m where m.program_id = any($1::bigint[]) and scenic_game_published(m.program_id, m.day, m.team_a)`,
    [ids, today],
  );
  const recap = inRecap(days.rows[0]?.last ?? null, today, localParts(now).hour);
  const mode = recap ? ("recap" as const) : ("upcoming" as const);
  const day = recap ? days.rows[0].last : (days.rows[0]?.next ?? null);
  if (!day) return { mode, day: null, rec: [], comp: [] };
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
    score_a: number | null;
    score_b: number | null;
    forfeit: "a" | "b" | null;
  }>(
    `select p.name as program, to_char(m.starts, 'HH24:MI') as starts, place.gym, place.court, place.map_lat, place.map_lng, place.map_place,
            g.grade, d.gender, g.level, ta.id::text as a_id, ta.name as a, tb.id::text as b_id, tb.name as b, m.home_side,
            m.score_a, m.score_b, m.forfeit
       from scenic_matchups m join scenic_programs p on p.id = m.program_id
       join scenic_teams ta on ta.id = m.team_a join scenic_teams tb on tb.id = m.team_b
       join scenic_registrations r on r.program_id = m.program_id and r.team_id = m.team_a
       join scenic_pools po on po.id = r.pool_id join scenic_grade_groups g on g.id = po.group_id
       join scenic_divisions d on d.id = g.division_id
       ${PLACE_SQL}
      where m.program_id = any($1::bigint[]) and m.day = $2::date
        and scenic_game_published(m.program_id, m.day, m.team_a) and ta.name not like '%(DEV)' and tb.name not like '%(DEV)'`,
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
      final:
        m.forfeit || m.score_a !== null
          ? {
              home: aHome ? m.score_a : m.score_b,
              away: aHome ? m.score_b : m.score_a,
              forfeit: m.forfeit ? ((m.forfeit === "a") === aHome ? ("home" as const) : ("away" as const)) : null,
            }
          : null,
      grade: m.grade,
      level: m.level,
    };
  });
  const strip = (g: (typeof all)[number]): GotwGame => ({
    day: g.day, starts: g.starts, gym: g.gym, court: g.court, map: g.map, group: g.group, program: g.program, home: g.home, away: g.away,
    ...(recap ? { final: g.final } : {}),
  });
  const pick = recap ? recapGames : rankGames;
  return {
    mode,
    day,
    rec: pick(all.filter((g) => g.level !== "COMP")).map(strip),
    comp: pick(all.filter((g) => g.level === "COMP")).map(strip),
  };
}
