// Scores (SPEC.md section 13): a League game's final score, entered on or after its Game Day by a Director of Scores
// (or an Owner or Admin) of the organization whose gym it was played at, or of the League's organization (every game
// of its Leagues). A forfeit instead of a score: the side that forfeited. Saving (or clearing) works the program's
// Power Index out again (lib/power-index), in the same transaction. Who entered it, and when, is recorded.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { directionsUrl } from "./directions";
import { recomputePi } from "./power-index";
import { takeSnapshots } from "./roster-snapshot";
import { PLACE_SQL } from "./scenic-games";
import { gradeLabel } from "./scenic-teams";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

// The organization whose gym a game is at (its court key: "o<gym>-<court>" an organization's gym, digits a partner's court).
const GYM_ORG = `(select coalesce(
    (select g.org from gyms g where m.court_key like 'o%' and g.id::text = split_part(substr(m.court_key, 2), '-', 1)),
    (select pa.org_slug from partner_courts pc join partner_gyms pg on pg.id = pc.gym_id join partners pa on pa.id = pg.partner_id
      where m.court_key ~ '^[0-9]+$' and pc.id = m.court_key::bigint)))`;
// An organization's Owners, Admins (CourtCaptain staff too) and Directors of Scores, read straight from the roles.
const SCORER = (who: string, org: string) =>
  `(acts_as(${who}, ${org}, 'Admin') or (has_role(${who}, ${org}, 'Director')
     and exists (select 1 from active_director_areas a where a.coach_id = ${who} and a.org = ${org} and a.area = 'scores')))`;

// Whether this person enters scores for this organization (its Home's Scores card).
export async function scoresFor(q: Pick<Queryable, "query">, viewer: SessionUser, org: string): Promise<boolean> {
  const r = await q.query<{ ok: boolean }>(`select ${SCORER("$1", "$2")} as ok`, [viewer.coachId, org]);
  return r.rows[0]?.ok ?? false;
}

export type ScoreGame = {
  id: string;
  day: string;
  starts: string | null;
  gym: string | null;
  court: string | null;
  map: string | null;
  group: string; // "5th Boys COMP"
  program: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  forfeit: "home" | "away" | null;
  scoredBy: string | null;
};

// The games this organization scores (played at its gyms, or every game of its own Leagues) up to today, newest Game
// Day first, in current programs (and those ended in the last 2 weeks). Null: not one of its scorers.
export async function scoreGames(q: Pick<Queryable, "query">, viewer: SessionUser, org: string, now: Date): Promise<ScoreGame[] | null> {
  if (!(await scoresFor(q, viewer, org))) return null;
  const today = easternDate(now);
  const r = await q.query<{
    id: string;
    day: string;
    starts: string | null;
    gym: string | null;
    court: string | null;
    map_lat: number | null;
    map_lng: number | null;
    map_place: string | null;
    grade: number;
    gender: string;
    level: string;
    program: string;
    a: string;
    b: string;
    home_side: string | null;
    score_a: number | null;
    score_b: number | null;
    forfeit: "a" | "b" | null;
    scored_by: string | null;
  }>(
    `select m.id::text, m.day::text, to_char(m.starts, 'HH24:MI') as starts, place.gym, place.court, place.map_lat, place.map_lng,
            place.map_place, gg.grade, d.gender, gg.level, p.name as program, ta.name as a, tb.name as b, m.home_side,
            m.score_a, m.score_b, m.forfeit, m.scored_by
       from scenic_matchups m join scenic_programs p on p.id = m.program_id
       join scenic_teams ta on ta.id = m.team_a join scenic_teams tb on tb.id = m.team_b
       join scenic_registrations r on r.program_id = m.program_id and r.team_id = m.team_a
       join scenic_pools po on po.id = r.pool_id join scenic_grade_groups gg on gg.id = po.group_id
       join scenic_divisions d on d.id = gg.division_id
       ${PLACE_SQL}
      where m.day <= $2::date and p.ends_on >= $2::date - 14 and ta.name not like '%(DEV)' and tb.name not like '%(DEV)'
        and (p.org = $1 or ${GYM_ORG} = $1)
      order by m.day desc, m.starts nulls last, lower(place.gym), lower(place.court), m.id`,
    [org, today],
  );
  return r.rows.map((m) => {
    const aHome = (m.home_side ?? "a") === "a";
    return {
      id: m.id,
      day: m.day,
      starts: m.starts,
      gym: m.gym,
      court: m.court,
      map: directionsUrl(m.map_lat, m.map_lng, m.map_place),
      group: `${gradeLabel(m.grade, m.grade)} ${m.gender} ${m.level}`,
      program: m.program,
      home: aHome ? m.a : m.b,
      away: aHome ? m.b : m.a,
      homeScore: aHome ? m.score_a : m.score_b,
      awayScore: aHome ? m.score_b : m.score_a,
      forfeit: m.forfeit ? ((m.forfeit === "a") === aHome ? "home" : "away") : null,
      scoredBy: m.scored_by,
    };
  });
}

const points = (v: unknown): number | null | undefined => {
  if (v === "" || v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) && n >= 0 && n <= 250 ? n : undefined;
};

// Save a game's final score (home and away points), a forfeit ("home" or "away": who forfeited), or clear it (both
// blank, no forfeit). On or after its Game Day; no ties. Its program's PIs are worked out again.
export async function saveScore(
  deps: Deps,
  viewer: SessionUser,
  matchupId: unknown,
  input: { home?: unknown; away?: unknown; forfeit?: unknown },
): Promise<Result> {
  if (!isId(matchupId)) return { ok: false, message: "That game wasn't found." };
  const home = points(input.home);
  const away = points(input.away);
  const forfeit = input.forfeit === "home" || input.forfeit === "away" ? input.forfeit : null;
  if (home === undefined || away === undefined) return { ok: false, message: "Scores are whole numbers from 0 to 250." };
  if (!forfeit && (home === null) !== (away === null)) return { ok: false, message: "Enter both scores (or neither to clear it)." };
  if (!forfeit && home !== null && home === away) return { ok: false, message: "A game can't end tied: check the scores." };
  return withTx(deps.pool, async (q) => {
    const m = (
      await q.query<{ program_id: string; day: string; home_side: string | null; may: boolean }>(
        `select m.program_id::text, m.day::text, m.home_side,
                (${SCORER("$2", "p.org")} or coalesce(${SCORER("$2", GYM_ORG)}, false)) as may
           from scenic_matchups m join scenic_programs p on p.id = m.program_id
          where m.id = $1 and m.team_b is not null for update of m`,
        [matchupId, viewer.coachId],
      )
    ).rows[0];
    if (!m) return { ok: false as const, message: "That game wasn't found." };
    if (!m.may) return { ok: false as const, message: "Only a Director of Scores of the gym's organization (or the League's) can enter this score." };
    if (m.day > easternDate(deps.now())) return { ok: false as const, message: "Scores go in on or after the Game Day." };
    const aHome = (m.home_side ?? "a") === "a";
    const scoreA = forfeit ? null : aHome ? home : away;
    const scoreB = forfeit ? null : aHome ? away : home;
    const ff = forfeit ? ((forfeit === "home") === aHome ? "a" : "b") : null;
    const cleared = !forfeit && home === null;
    await q.query(
      "update scenic_matchups set score_a = $2, score_b = $3, forfeit = $4, scored_by = $5, scored_at = $6 where id = $1",
      [matchupId, scoreA, scoreB, ff, cleared ? null : by(viewer), cleared ? null : deps.now()],
    );
    await recomputePi(q, m.program_id, deps.now());
    // Both teams have played: their League roster snapshots are saved if it was their 1st game (a forfeit counts).
    const ab = (await q.query<{ a: string; b: string }>("select team_a::text as a, team_b::text as b from scenic_matchups where id = $1", [matchupId])).rows[0];
    await takeSnapshots(q, [ab.a, ab.b], deps.now());
    return { ok: true as const };
  });
}
