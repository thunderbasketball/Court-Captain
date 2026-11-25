// Games to correct (SPEC.md section 13): games still to be played whose teams don't belong together any more, because a team's grade,
// level or gender changed after they were made: a team now in another division, or REC against COMP (not a fill-in). Read live, so
// it's right however the team was changed, and gone once corrected. The League's Admins and Directors of Scheduling put TBD in a
// team's place or remove the game (once its level is unpublished that day).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { gradeRange } from "./scenic-teams";
import { PLACE_SQL } from "./scenic-games";
import { gameToTbd } from "./schedule-removal";
import { isScheduler } from "./scenic-programs";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };
export type GameToCorrect = {
  id: string;
  programId: string;
  program: string;
  day: string;
  division: string; // the game's: "Boys K–1st"
  level: string; // the game's (its publishing)
  starts: string | null;
  gym: string | null;
  published: boolean;
  a: { id: string; name: string };
  b: { id: string; name: string } | null;
  why: string[]; // "1B Koch is now Boys 2nd–3rd COMP (changed by Earl Epps)"
  teams: string[]; // who can be replaced with TBD
};

// A League organization's (or one program's) games to correct, by date and time. The caller has checked who may see them.
export async function gamesToCorrect(q: Pick<Queryable, "query">, which: { org: string } | { programId: string }, now: Date): Promise<GameToCorrect[]> {
  type Reg = { div: string; gender: string; low: number; high: number; level: string; by: string | null };
  const reg = (t: string) => `left join lateral (select d.id::text as div, d.gender, d.grade_low as low, d.grade_high as high, g.level, r.moved_by as by
      from scenic_registrations r join scenic_pools o on o.id = r.pool_id join scenic_grade_groups g on g.id = o.group_id join scenic_divisions d on d.id = g.division_id
     where r.program_id = m.program_id and r.team_id = m.${t})`;
  const r = await q.query<{
    id: string; program_id: string; program: string; day: string; div: string; gender: string; low: number; high: number; starts: string | null; gym: string | null; published: boolean; fill: boolean;
    a: string; a_name: string; b: string | null; b_name: string | null; ra: Reg | null; rb: Reg | null;
  }>(
    `select m.id::text, m.program_id::text, p.name as program, m.day::text, d.id::text as div, d.gender, d.grade_low as low, d.grade_high as high,
            to_char(m.starts, 'HH24:MI') as starts, place.gym, scenic_game_published(m.program_id, m.day, m.team_a) as published, m.fill_team is not null as fill,
            ta.id::text as a, ta.name as a_name, tb.id::text as b, tb.name as b_name, row_to_json(ra) as ra, row_to_json(rb) as rb
       from scenic_matchups m join scenic_programs p on p.id = m.program_id join scenic_divisions d on d.id = m.division_id
       join scenic_teams ta on ta.id = m.team_a left join scenic_teams tb on tb.id = m.team_b
       ${reg("team_a")} ra on true ${reg("team_b")} rb on true ${PLACE_SQL}
      where ${"org" in which ? "p.org = $1" : "p.id = $1::bigint"} and m.day >= $2::date and m.score_a is null and m.forfeit is null
        and (ra.div <> m.division_id::text or (m.fill_team is null and (rb.div <> m.division_id::text or rb.level <> ra.level)))
      order by m.day, m.starts nulls last, lower(ta.name)`,
    ["org" in which ? which.org : which.programId, easternDate(now)],
  );
  return r.rows.map((g) => {
    const list = [
      { id: g.a, name: g.a_name, reg: g.ra },
      ...(g.b && !g.fill ? [{ id: g.b, name: g.b_name!, reg: g.rb }] : []), // a fill-in may be from any division
    ];
    const off = list.filter((t) => t.reg && t.reg.div !== g.div);
    const mixed = !off.length && !g.fill;
    return {
      id: g.id,
      programId: g.program_id,
      program: g.program,
      day: g.day,
      division: `${g.gender} ${gradeRange(g.low, g.high)}`,
      level: g.ra?.level ?? "",
      starts: g.starts,
      gym: g.gym,
      published: g.published,
      a: { id: g.a, name: g.a_name },
      b: g.b ? { id: g.b, name: g.b_name! } : null,
      why: mixed
        ? list.map((t) => `${t.name} is ${t.reg?.level}${t.reg?.by ? ` (changed by ${t.reg.by})` : ""}`)
        : off.map((t) => `${t.name} is now ${t.reg!.gender} ${gradeRange(t.reg!.low, t.reg!.high)} ${t.reg!.level}${t.reg!.by ? ` (changed by ${t.reg!.by})` : ""}`),
      teams: (mixed ? list : off).map((t) => t.id),
    };
  });
}

// TBD in a team's place, or (no team) the game removed. Only a game that's to be corrected.
export async function correctGame(deps: Deps, viewer: SessionUser, matchupId: unknown, teamId: unknown): Promise<Result> {
  if (typeof matchupId !== "string" || !/^\d{1,18}$/.test(matchupId) || (teamId !== null && (typeof teamId !== "string" || !/^\d{1,18}$/.test(teamId)))) return { ok: false, message: "Pick a game." };
  if (!(await isScheduler(deps.pool, viewer))) return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
  return withTx(deps.pool, async (q) => {
    const m = await q.query<{ program: string }>("select program_id::text as program from scenic_matchups where id = $1", [matchupId]);
    const gone = { ok: false as const, message: "That game was changed. Reload the page." };
    if (!m.rows[0]) return gone;
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-matchups:' || $1))", [m.rows[0].program]);
    const g = (await gamesToCorrect(q, { programId: m.rows[0].program }, deps.now())).find((x) => x.id === matchupId);
    if (!g) return gone;
    if (g.published) return { ok: false as const, message: `That day's ${g.level} schedule is published: unpublish ${g.level} for that day first.` };
    if (teamId === null) {
      await q.query("delete from scenic_matchups where id = $1", [matchupId]);
      return { ok: true as const };
    }
    if (!g.teams.includes(teamId as string)) return gone;
    const no = await gameToTbd(q, matchupId, teamId as string);
    return no ? { ok: false as const, message: `${no} Change that game first, or remove this one.` } : { ok: true as const };
  });
}
