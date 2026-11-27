// A game coming up as a picture to share (SPEC.md section 13): a published League game with both teams and a time, not played
// yet. Public: the teams and their organizations' logos, home and away, the grade, the day, time and gym, and the League. No
// players. Never a simulated (DEV) team's game.
import { PLACE_SQL } from "./scenic-games";
import { gradeLabel } from "./scenic-teams";
import type { Queryable } from "./sql";

export type GameSide = { name: string; org: string | null; from: string }; // org: its organization's slug (its logo), when it has one
export type GameCard = {
  id: string;
  org: string; // the League's organization
  program: string;
  group: string; // "3rd Boys COMP"
  day: string;
  starts: string; // "HH:MM"
  gym: string | null;
  court: string | null;
  home: GameSide;
  away: GameSide;
};

// The card for one game; null when it isn't to be shared (not published, no opponent or time yet, or already played).
export async function gameCard(q: Pick<Queryable, "query">, id: unknown): Promise<GameCard | null> {
  if (typeof id !== "string" || !/^\d{1,18}$/.test(id)) return null;
  const side = (t: string) => `json_build_object('name', ${t}.name,
      'org', coalesce((select pa.org_slug from partners pa where pa.id = ${t}.partner_id), (select ot.org from org_teams ot where ot.id = ${t}.org_team_id), case when ${t}.thunder_team_id is not null then 'thunder' end),
      'from', coalesce((select pa.name from partners pa where pa.id = ${t}.partner_id), ''))`;
  const r = await q.query<{
    id: string; org: string; program: string; day: string; starts: string; gym: string | null; court: string | null;
    grade: number; gender: string; level: string; a: GameSide; b: GameSide; home_side: string | null;
  }>(
    `select m.id::text, p.org, p.name as program, m.day::text, to_char(m.starts, 'HH24:MI') as starts, place.gym, place.court,
            g.grade, d.gender, g.level, ${side("ta")} as a, ${side("tb")} as b, m.home_side
       from scenic_matchups m join scenic_programs p on p.id = m.program_id and p.kind = 'League'
       join scenic_teams ta on ta.id = m.team_a join scenic_teams tb on tb.id = m.team_b
       join scenic_registrations r on r.program_id = m.program_id and r.team_id = m.team_a
       join scenic_pools po on po.id = r.pool_id join scenic_grade_groups g on g.id = po.group_id join scenic_divisions d on d.id = g.division_id
       ${PLACE_SQL}
      where m.id = $1 and m.starts is not null and m.score_a is null and m.forfeit is null
        and ta.name not like '%(DEV)' and tb.name not like '%(DEV)' and scenic_game_published(m.program_id, m.day, m.team_a)`,
    [id],
  );
  const m = r.rows[0];
  if (!m) return null;
  const aHome = (m.home_side ?? "a") === "a";
  return {
    id: m.id,
    org: m.org,
    program: m.program,
    group: `${gradeLabel(m.grade, m.grade)} ${m.gender} ${m.level}`,
    day: m.day,
    starts: m.starts,
    gym: m.gym,
    court: m.court,
    home: aHome ? m.a : m.b,
    away: aHome ? m.b : m.a,
  };
}

// The words that go with it.
export const gameText = (c: Pick<GameCard, "group" | "home" | "away">) => `GAME DAY · ${c.group}: ${c.away.name} at ${c.home.name}`;
