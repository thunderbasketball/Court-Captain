// A registered team whose gender, grade or level changed (SPEC.md section 13): its registration in each League not ended moves to
// the division, grade and level it now belongs in (that group's smallest pool; who moved it recorded). What it registered for and
// paid stays. Its games still to come are left as they are and shown as Games to correct (lib/schedule-corrections); whoever changes
// it is warned of each one first. An organization's own team is withdrawn first (lib/org-teams).
import type { PoolClient } from "pg";
import { gradeLabel } from "./scenic-teams";
import { PLACE_SQL } from "./scenic-games";
import { poolFor, recOpen } from "./scenic-programs";
import { easternDate, timeLabel } from "./time";

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Thrown to undo the change and ask first: each game it would leave to correct.
export class AskFirst extends Error {
  constructor(public readonly warn: string[]) {
    super("It has games: look at them first.");
  }
}

// Why it can't change; or the Leagues where it moved. `staff`: the League's own (REC anyway). Without `anyway`, games to correct
// throw AskFirst.
export async function placeAgain(q: PoolClient, teamId: string, staff: boolean, anyway: boolean, byName: string, now: Date): Promise<{ error: string } | { moved: string[] }> {
  const today = easternDate(now);
  const regs = await q.query<{ program: string; name: string; team: string; gender: string; grade: number; level: string; fits: boolean }>(
    `select p.id::text as program, p.name, t.name as team, t.gender, t.grade, t.level, (d.gender = t.gender and g.grade = t.grade and g.level = t.level) as fits
       from scenic_registrations r join scenic_teams t on t.id = r.team_id join scenic_programs p on p.id = r.program_id
       join scenic_pools o on o.id = r.pool_id join scenic_grade_groups g on g.id = o.group_id join scenic_divisions d on d.id = g.division_id
      where r.team_id = $1 and p.ends_on >= $2::date order by p.starts_on`,
    [teamId, today],
  );
  const moved: string[] = [];
  const warn: string[] = [];
  for (const r of regs.rows.filter((x) => !x.fits)) {
    const pool = await poolFor(q, r.program, r);
    if (!pool) return { error: `${r.name} has no ${r.gender} ${gradeLabel(r.grade, r.grade)} ${r.level}. Withdraw ${r.team} from it first.` };
    if (!staff && !(await recOpen(q, r.program, teamId))) return { error: `REC in ${r.name} is only for the organizations the League picked.` };
    const games = await q.query<{ day: string; starts: string | null; gym: string | null; a: string; b: string; published: boolean }>(
      `select m.day::text, to_char(m.starts, 'HH24:MI') as starts, place.gym, ta.name as a, coalesce(tb.name, 'TBD') as b, scenic_game_published(m.program_id, m.day, m.team_a) as published
         from scenic_matchups m join scenic_teams ta on ta.id = m.team_a left join scenic_teams tb on tb.id = m.team_b ${PLACE_SQL}
        where m.program_id = $1 and $2::bigint in (m.team_a, m.team_b) and m.day >= $3::date and m.score_a is null and m.forfeit is null
        order by m.day, m.starts nulls last`,
      [r.program, teamId, today],
    );
    warn.push(...games.rows.map((g) => `${day(g.day)}${g.starts ? ` ${timeLabel(g.starts)}` : ""}${g.gym ? ` at ${g.gym}` : g.starts ? "" : " (not on the grid)"}: ${g.a} vs ${g.b}${g.published ? " · published" : ""}`));
    await q.query("update scenic_registrations set pool_id = $3, moved_by = $4, moved_at = $5 where program_id = $1 and team_id = $2", [r.program, teamId, pool.id, byName, now]);
    moved.push(r.name);
  }
  if (warn.length && !anyway) throw new AskFirst(warn);
  return { moved };
}
