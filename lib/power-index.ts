// The Power Index (PI, 0–1000; SPEC.md section 13): each team's strength in one program, worked out again from all of
// that program's scored games whenever a score is entered (stored in scenic_pi). Everyone starts at 500.
// Each game (in date and time order) moves points from the loser to the winner, more when the result is a surprise:
// - Expected result from the two PIs (Elo: 400 points apart ≈ 10 to 1).
// - Only differences adjust it, never the grade itself (3rd vs 3rd counts the same as 8th vs 8th): the opponent counts
//   `gradePoints` stronger for each grade older, and `levelPoints` stronger for COMP against REC. So playing up (or REC
//   beating COMP) gains more, and losing to a younger or REC team costs more.
// - Margin of victory, capped (`marginCap`): a clear win moves up to 1.5× a one-point win; a forfeit counts 1×.
// - Brackets games weigh `bracketWeight` (1.25×).
// Shown: pulled toward 500 while a team has few games (games ÷ (games + 2)), plus a small strength-of-schedule credit
// (a tenth of how far its opponents' average strength at game time, grade and level difference included, is from 500),
// kept within 0–1000.
import type { PoolClient } from "pg";
import type { Queryable } from "./sql";

export type PiSettings = { gradePoints: number; levelPoints: number; marginCap: number; bracketWeight: number };
export const PI_DEFAULTS: PiSettings = { gradePoints: 50, levelPoints: 100, marginCap: 15, bracketWeight: 1.25 };
export const PI_START = 500;
const K = 32;

export type PiTeam = { id: string; grade: number; level: string };
export type PiGame = {
  a: PiTeam;
  b: PiTeam;
  scoreA: number | null;
  scoreB: number | null;
  forfeit: "a" | "b" | null; // the side that forfeited
  bracket: boolean;
};
export type PiResult = { pi: number; wins: number; losses: number; games: number };

// How much stronger `them` counts than `me`: their grades older, and COMP against REC.
const offset = (me: PiTeam, them: PiTeam, s: PiSettings) =>
  s.gradePoints * (them.grade - me.grade) + s.levelPoints * ((them.level === "COMP" ? 1 : 0) - (me.level === "COMP" ? 1 : 0));

// Pure: every team's PI from the games in order (scored or forfeited ones; others are skipped).
export function computePi(teams: string[], games: PiGame[], s: PiSettings = PI_DEFAULTS): Map<string, PiResult> {
  const r = new Map<string, number>(teams.map((t) => [t, PI_START]));
  const rec = new Map<string, { w: number; l: number; opp: number[] }>(teams.map((t) => [t, { w: 0, l: 0, opp: [] }]));
  for (const g of games) {
    const decided = g.forfeit !== null || (g.scoreA !== null && g.scoreB !== null);
    if (!decided) continue;
    for (const t of [g.a.id, g.b.id]) {
      if (!r.has(t)) r.set(t, PI_START);
      if (!rec.has(t)) rec.set(t, { w: 0, l: 0, opp: [] });
    }
    const ra = r.get(g.a.id)!;
    const rb = r.get(g.b.id)!;
    // A's result: 1 win, 0 loss, ½ a tie.
    const sa = g.forfeit ? (g.forfeit === "a" ? 0 : 1) : g.scoreA! > g.scoreB! ? 1 : g.scoreA! < g.scoreB! ? 0 : 0.5;
    const ea = 1 / (1 + 10 ** ((rb + offset(g.a, g.b, s) - ra) / 400));
    const margin = g.forfeit ? 0 : Math.min(Math.abs(g.scoreA! - g.scoreB!), s.marginCap);
    const k = K * (1 + (0.5 * margin) / s.marginCap) * (g.bracket ? s.bracketWeight : 1);
    const move = k * (sa - ea);
    r.set(g.a.id, ra + move);
    r.set(g.b.id, rb - move);
    const A = rec.get(g.a.id)!;
    const B = rec.get(g.b.id)!;
    // How strong each opponent counted at game time (its PI then, plus the grade and level difference).
    A.opp.push(rb + offset(g.a, g.b, s));
    B.opp.push(ra + offset(g.b, g.a, s));
    if (sa === 1) {
      A.w++;
      B.l++;
    } else if (sa === 0) {
      A.l++;
      B.w++;
    }
  }
  const out = new Map<string, PiResult>();
  for (const [t, raw] of r) {
    const x = rec.get(t)!;
    const games = x.opp.length;
    const shrunk = PI_START + (raw - PI_START) * (games / (games + 2));
    const sos = games ? (x.opp.reduce((n, o) => n + o, 0) / games - PI_START) / 10 : 0;
    out.set(t, { pi: Math.round(Math.max(0, Math.min(1000, shrunk + sos))), wins: x.w, losses: x.l, games });
  }
  return out;
}

// A program's PI settings (its gear; defaults until changed).
export async function piSettings(q: Pick<Queryable, "query">, programId: string): Promise<PiSettings & { setBy: string | null }> {
  const r = await q.query<PiSettings & { setBy: string | null }>(
    `select pi_grade_points as "gradePoints", pi_level_points as "levelPoints", pi_margin_cap as "marginCap",
            pi_bracket_weight::float as "bracketWeight", pi_set_by as "setBy" from scenic_programs where id = $1`,
    [programId],
  );
  return r.rows[0] ?? { ...PI_DEFAULTS, setBy: null };
}

// Work a program's PIs out again from all its scored games and store them (every registered team; none played: 500).
// Runs in the caller's transaction (after a score is saved).
export async function recomputePi(q: PoolClient, programId: string, now: Date): Promise<void> {
  const s = await piSettings(q, programId);
  const teams = (
    await q.query<{ id: string }>("select team_id::text as id from scenic_registrations where program_id = $1 and removed_by is null", [programId])
  ).rows.map((t) => t.id);
  const g = await q.query<{
    a: string;
    a_grade: number;
    a_level: string;
    b: string;
    b_grade: number;
    b_level: string;
    score_a: number | null;
    score_b: number | null;
    forfeit: "a" | "b" | null;
    bracket: boolean;
  }>(
    `select m.team_a::text as a, ta.grade as a_grade, ta.level as a_level, m.team_b::text as b, tb.grade as b_grade, tb.level as b_level,
            m.score_a, m.score_b, m.forfeit,
            exists (select 1 from program_game_days d join game_days gd on gd.id = d.game_day_id
                     where d.program_id = m.program_id and d.kind = 'bracket' and gd.day = m.day) as bracket
       from scenic_matchups m join scenic_teams ta on ta.id = m.team_a join scenic_teams tb on tb.id = m.team_b
      where m.program_id = $1 and (m.score_a is not null or m.forfeit is not null)
      order by m.day, m.starts nulls last, m.id`,
    [programId],
  );
  const res = computePi(
    teams,
    g.rows.map((x) => ({
      a: { id: x.a, grade: x.a_grade, level: x.a_level },
      b: { id: x.b, grade: x.b_grade, level: x.b_level },
      scoreA: x.score_a,
      scoreB: x.score_b,
      forfeit: x.forfeit,
      bracket: x.bracket,
    })),
    s,
  );
  await q.query("delete from scenic_pi where program_id = $1", [programId]);
  for (const [team, p] of res)
    await q.query(
      "insert into scenic_pi (program_id, team_id, pi, wins, losses, games, updated_at) values ($1, $2, $3, $4, $5, $6, $7)",
      [programId, team, p.pi, p.wins, p.losses, p.games, now],
    );
}
