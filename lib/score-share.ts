// A game's final as a picture to share (SPEC.md section 13): a published League game's final score, 10 minutes after it was
// entered, so a typo is fixed first. Public: team names, the score, the grade, the League and the date; no players. Never a
// forfeit, a simulated team's game, or one on a Game Day that isn't published for its level.
import { gradeLabel } from "./scenic-teams";
import type { Queryable } from "./sql";

export const SHARE_MINUTES = 10;

// A game's final as the public pages show it. `share`: its picture is ready.
export type PublicFinal = { id: string; home: number | null; away: number | null; forfeit: "home" | "away" | null; share: boolean };

type Row = { id: string; home_side: string | null; score_a: number | null; score_b: number | null; forfeit: "a" | "b" | null; scored_at: Date | null };

// Null until there's a score (or a forfeit).
export function finalOf(m: Row, now: Date): PublicFinal | null {
  const scored = m.score_a !== null && m.score_b !== null;
  if (!scored && !m.forfeit) return null;
  const aHome = (m.home_side ?? "a") === "a";
  return {
    id: m.id,
    home: aHome ? m.score_a : m.score_b,
    away: aHome ? m.score_b : m.score_a,
    forfeit: m.forfeit ? ((m.forfeit === "a") === aHome ? "home" : "away") : null,
    share: scored && !m.forfeit && !!m.scored_at && m.scored_at.getTime() <= now.getTime() - SHARE_MINUTES * 60_000,
  };
}

export type ScoreCard = {
  id: string;
  org: string; // the League's organization
  program: string;
  group: string; // "5th Boys REC"
  day: string;
  winner: { name: string; score: number };
  loser: { name: string; score: number };
};

// The card for one game; null when it isn't to be shared (yet).
export async function scoreCard(q: Pick<Queryable, "query">, now: Date, id: unknown): Promise<ScoreCard | null> {
  if (typeof id !== "string" || !/^\d{1,18}$/.test(id)) return null;
  const r = await q.query<{
    id: string;
    org: string;
    program: string;
    day: string;
    grade: number;
    gender: string;
    level: string;
    a: string;
    b: string;
    score_a: number;
    score_b: number;
  }>(
    `select m.id::text, p.org, p.name as program, m.day::text, g.grade, d.gender, g.level, ta.name as a, tb.name as b, m.score_a, m.score_b
       from scenic_matchups m join scenic_programs p on p.id = m.program_id and p.kind = 'League'
       join scenic_teams ta on ta.id = m.team_a join scenic_teams tb on tb.id = m.team_b
       join scenic_registrations r on r.program_id = m.program_id and r.team_id = m.team_a
       join scenic_pools po on po.id = r.pool_id join scenic_grade_groups g on g.id = po.group_id join scenic_divisions d on d.id = g.division_id
      where m.id = $1 and m.score_a is not null and m.score_b is not null and m.forfeit is null and m.scored_at <= $2
        and ta.name not like '%(DEV)' and tb.name not like '%(DEV)' and scenic_game_published(m.program_id, m.day, m.team_a)`,
    [id, new Date(now.getTime() - SHARE_MINUTES * 60_000)],
  );
  const m = r.rows[0];
  if (!m) return null;
  const a = { name: m.a, score: m.score_a };
  const b = { name: m.b, score: m.score_b };
  return {
    id: m.id,
    org: m.org,
    program: m.program,
    group: `${gradeLabel(m.grade, m.grade)} ${m.gender} ${m.level}`,
    day: m.day,
    winner: a.score > b.score ? a : b,
    loser: a.score > b.score ? b : a,
  };
}

// The words that go with it.
export const shareText = (c: Pick<ScoreCard, "group" | "winner" | "loser">) =>
  `FINAL · ${c.group}: ${c.winner.name} ${c.winner.score}, ${c.loser.name} ${c.loser.score}`;
