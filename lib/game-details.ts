// A League game's details (SPEC.md section 13), opened from any schedule (public pages, team pages, parents): for each of
// its two teams, its season record (with every result) and Power Index in that program, points per game, point
// differential and streak. From the program's scored (or forfeited) games. Public: only a
// published game with both teams, and only what public pages already show (team names, scores, PI).
import type { Queryable } from "./sql";

export type PastGame = { date: string; opponent: string; result: "W" | "L"; score: string }; // score: "30-23" (its own first) or "Forfeit"
export type TeamStats = {
  id: string;
  name: string;
  side: "home" | "away";
  pi: number;
  wins: number;
  losses: number;
  ppg: number | null; // points per game (scored games only; a forfeit has no points)
  diff: number | null; // points per game − points against per game
  streak: string | null; // "W2", "L1"
  games: PastGame[]; // every result this season, newest first
};
export type GameDetails = { teams: [TeamStats, TeamStats] }; // away, then home

const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const round1 = (n: number) => Math.round(n * 10) / 10;

export async function gameDetails(q: Pick<Queryable, "query">, id: unknown): Promise<GameDetails | null> {
  if (!isId(id)) return null;
  const g = (
    await q.query<{ program: string; a: string; b: string; a_name: string; b_name: string; home: string | null }>(
      `select m.program_id::text as program, m.team_a::text as a, m.team_b::text as b, ta.name as a_name, tb.name as b_name, m.home_side as home
         from scenic_matchups m join scenic_teams ta on ta.id = m.team_a join scenic_teams tb on tb.id = m.team_b
        where m.id = $1 and scenic_game_published(m.program_id, m.day, m.team_a)
          and ta.name not like '%(DEV)' and tb.name not like '%(DEV)'`,
      [id],
    )
  ).rows[0];
  if (!g) return null;
  const [played, pis] = await Promise.all([
    q.query<{ day: string; starts: string | null; a: string; b: string; a_name: string; b_name: string; sa: number | null; sb: number | null; forfeit: "a" | "b" | null }>(
      `select m.day::text, to_char(m.starts, 'HH24:MI') as starts, m.team_a::text as a, m.team_b::text as b, ta.name as a_name, tb.name as b_name,
              m.score_a as sa, m.score_b as sb, m.forfeit
         from scenic_matchups m join scenic_teams ta on ta.id = m.team_a join scenic_teams tb on tb.id = m.team_b
        where m.program_id = $1 and (m.team_a = any($2::bigint[]) or m.team_b = any($2::bigint[]))
          and (m.score_a is not null or m.forfeit is not null)
        order by m.day desc, m.starts desc nulls last, m.id desc`,
      [g.program, [g.a, g.b]],
    ),
    q.query<{ team: string; pi: number }>("select team_id::text as team, pi from scenic_pi where program_id = $1 and team_id = any($2::bigint[])", [
      g.program,
      [g.a, g.b],
    ]),
  ]);
  const piOf = new Map(pis.rows.map((x) => [x.team, x.pi]));
  const stats = (team: string, name: string, side: "home" | "away"): TeamStats => {
    // Its games, newest first, from its side.
    const mine = played.rows
      .filter((m) => m.a === team || m.b === team)
      .map((m) => {
        const us = m.a === team ? "a" : "b";
        const own = us === "a" ? m.sa : m.sb;
        const opp = us === "a" ? m.sb : m.sa;
        const won = m.forfeit ? m.forfeit !== us : (own ?? 0) > (opp ?? 0);
        return { date: m.day, opponent: us === "a" ? m.b_name : m.a_name, won, own, opp, forfeit: !!m.forfeit };
      });
    const scored = mine.filter((m) => !m.forfeit && m.own !== null && m.opp !== null);
    const ppg = scored.length ? round1(scored.reduce((s, m) => s + m.own!, 0) / scored.length) : null;
    const pa = scored.length ? round1(scored.reduce((s, m) => s + m.opp!, 0) / scored.length) : null;
    let run = 0;
    while (run < mine.length && mine[run].won === mine[0].won) run++;
    const wins = mine.filter((m) => m.won).length;
    return {
      id: team,
      name,
      side,
      pi: piOf.get(team) ?? 500,
      wins,
      losses: mine.length - wins,
      ppg,
      diff: ppg !== null && pa !== null ? round1(ppg - pa) : null,
      streak: mine.length ? `${mine[0].won ? "W" : "L"}${run}` : null,
      games: mine.map((m) => ({ date: m.date, opponent: m.opponent, result: m.won ? "W" : "L", score: m.forfeit ? "Forfeit" : `${m.own}-${m.opp}` })),
    };
  };
  const aHome = (g.home ?? "a") === "a";
  const a = stats(g.a, g.a_name, aHome ? "home" : "away");
  const b = stats(g.b, g.b_name, aHome ? "away" : "home");
  return { teams: aHome ? [b, a] : [a, b] };
}
