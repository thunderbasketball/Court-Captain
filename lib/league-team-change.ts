// A registered team's gender, grade and level stay as registered (its organization's); the League doesn't change them. It
// can place the team to play in another division or grade of its League instead (SPEC.md section 13).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { orgHasArea } from "./org-admin";
import { gradeLabel, gradeRange } from "./scenic-teams";
import { PLACE_SQL } from "./scenic-games";
import { AskFirst } from "./scenic-replace";
import { easternDate, timeLabel } from "./time";
import { withTx } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string; warn?: string[] };
class Refused extends Error {}

const LEAGUE = "scenic-city";

// ---- Play in another division (the League places a registered team outside its own gender or grade) ----

export type PlayInChoice = { poolId: string; label: string; own: boolean }; // "Boys 2nd–3rd · 2nd REC · Pool A"
export type PlayIn = {
  programId: string;
  program: string;
  poolId: string; // where it plays now
  playsIn: { label: string; by: string; why: string } | null; // placed outside its own by the League
  choices: PlayInChoice[]; // every pool of its level in that League
};

// A registered team's Leagues not ended, where it plays and where it could (its own level only).
export async function playInChoices(q: Pick<Pool, "query">, teamId: string, now: Date): Promise<PlayIn[]> {
  const r = await q.query<{
    program: string; name: string; pool: string; by: string | null; why: string | null;
    pools: { id: string; name: string; many: boolean; gender: string; low: number; high: number; grade: number; own: boolean }[];
  }>(
    `select p.id::text as program, p.name, r.pool_id::text as pool, r.plays_in_by as by, r.plays_in_why as why,
            coalesce((select json_agg(json_build_object('id', o.id::text, 'name', o.name, 'gender', d.gender, 'low', d.grade_low, 'high', d.grade_high,
                                                         'grade', g.grade, 'own', (d.gender = t.gender or d.gender = 'Coed') and g.grade = t.grade,
                                                         'many', (select count(*) from scenic_pools x where x.group_id = g.id) > 1)
                                       order by array_position(array['Coed', 'Boys', 'Girls'], d.gender), d.grade_low, g.grade, o.name)
                        from scenic_divisions d join scenic_grade_groups g on g.division_id = d.id join scenic_pools o on o.group_id = g.id
                       where d.program_id = p.id and g.level = t.level), '[]') as pools
       from scenic_registrations r join scenic_programs p on p.id = r.program_id and p.kind = 'League' and p.ends_on >= $2::date
       join scenic_teams t on t.id = r.team_id
      where r.team_id = $1 and r.removed_by is null order by p.starts_on`,
    [teamId, easternDate(now)],
  );
  return r.rows.map((x) => {
    const choices = x.pools.map((o) => ({
      poolId: o.id,
      label: `${o.gender} ${gradeRange(o.low, o.high)} · ${gradeLabel(o.grade, o.grade)}${o.many ? ` · ${o.name}` : ""}`,
      own: o.own,
    }));
    const now = choices.find((c) => c.poolId === x.pool);
    return {
      programId: x.program,
      program: x.name,
      poolId: x.pool,
      playsIn: x.by && now ? { label: now.label, by: x.by, why: x.why ?? "" } : null,
      choices,
    };
  });
}

// The League (Directors of Teams, Admins, Owners) places a registered team to play in another pool of its level in a League:
// its own gender and grade stay. Back in its own division clears it. Who, when and why are kept; its games still to come that
// day are left to correct (asked about first, as for a grade change).
export async function playIn(deps: Deps, viewer: SessionUser, teamId: unknown, programId: unknown, poolId: unknown, why: unknown, anyway: unknown): Promise<Result> {
  const no = { ok: false as const, message: "Only the League's Directors of Teams, Admins and Owners can do that." };
  if (viewer.actingBy || !(await orgHasArea(deps.pool, viewer.coachId, LEAGUE, "teams"))) return no;
  const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
  if (!isId(teamId) || !isId(programId) || !isId(poolId)) return { ok: false, message: "Pick where it plays." };
  const reason = typeof why === "string" ? why.trim() : "";
  if (reason.length > 200) return { ok: false, message: "Keep the reason under 200 characters." };
  const by = `${viewer.firstName} ${viewer.lastName}`;
  const now = deps.now();
  try {
    return await withTx(deps.pool, async (q) => {
      const reg = (
        await q.query<{ pool: string; level: string; name: string }>(
          `select r.pool_id::text as pool, t.level, t.name from scenic_registrations r join scenic_teams t on t.id = r.team_id
             join scenic_programs p on p.id = r.program_id and p.kind = 'League' and p.ends_on >= $3::date
            where r.program_id = $1 and r.team_id = $2 and r.removed_by is null for update of r`,
          [programId, teamId, easternDate(now)],
        )
      ).rows[0];
      if (!reg) throw new Refused("It isn't registered in that League now.");
      const choice = (await playInChoices(q, teamId, now)).find((p) => p.programId === programId)?.choices.find((c) => c.poolId === poolId);
      if (!choice) throw new Refused(`Pick a ${reg.level} pool in that League (to change its level, use Change grade or level).`);
      if (!choice.own && !reason) throw new Refused("Say why it plays there (the teams' organizations see it).");
      if (reg.pool === poolId) {
        await q.query("update scenic_registrations set plays_in_why = $3 where program_id = $1 and team_id = $2 and plays_in_by is not null", [programId, teamId, reason || null]);
        return { ok: true as const };
      }
      const games = await q.query<{ day: string; starts: string | null; gym: string | null; a: string; b: string; published: boolean }>(
        `select m.day::text, to_char(m.starts, 'HH24:MI') as starts, place.gym, ta.name as a, coalesce(tb.name, 'TBD') as b, scenic_game_published(m.program_id, m.day, m.team_a) as published
           from scenic_matchups m join scenic_teams ta on ta.id = m.team_a left join scenic_teams tb on tb.id = m.team_b ${PLACE_SQL}
          where m.program_id = $1 and $2::bigint in (m.team_a, m.team_b) and m.day >= $3::date and m.score_a is null and m.forfeit is null
          order by m.day, m.starts nulls last`,
        [programId, teamId, easternDate(now)],
      );
      if (games.rows.length && anyway !== true) {
        const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        throw new AskFirst(games.rows.map((g) => `${day(g.day)}${g.starts ? ` ${timeLabel(g.starts)}` : ""}${g.gym ? ` at ${g.gym}` : g.starts ? "" : " (not on the grid)"}: ${g.a} vs ${g.b}${g.published ? " · published" : ""}`));
      }
      await q.query(
        `update scenic_registrations set pool_id = $3, moved_by = $4, moved_at = $5,
                plays_in_by = case when $6 then null else $4 end, plays_in_at = case when $6 then null else $5::timestamptz end,
                plays_in_why = case when $6 then null else $7 end
          where program_id = $1 and team_id = $2`,
        [programId, teamId, poolId, by, now, choice.own, reason || null],
      );
      return { ok: true as const };
    });
  } catch (e) {
    if (e instanceof Refused) return { ok: false, message: e.message };
    if (e instanceof AskFirst) return { ok: false, message: e.message, warn: e.warn };
    throw e;
  }
}
