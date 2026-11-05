// Player evaluations (SPEC.md section 5). A team's Head Coach, Assistant Coach and the Director rate registered players
// in the team's grades and one grade below, same gender. Each team sees only its own cards; everyone who can evaluate
// sees which teams marked a player Interested and which team rostered them.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { HEIGHTS, NOTES_MAX, POSITIONS, SPEEDS, type Fields } from "./evaluation-fields";
import { withTx } from "./sql";
import { hasArea, seesWho } from "./org-admin";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export { HEIGHTS, NOTES_MAX, POSITIONS, SPEEDS, type Fields } from "./evaluation-fields";

const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const isRegistrant = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,40}$/.test(v);
const cantEvaluate = { ok: false as const, message: "Only this team's coaches can evaluate players." };

// Head Coach, Assistant Coach, or the Director.
export async function canEvaluate(q: Pick<Pool, "query">, viewer: SessionUser, teamId: string): Promise<boolean> {
  if (!isId(teamId)) return false;
  if (hasArea(viewer, "teams")) return true;
  const r = await q.query(
    "select 1 from team_staff where team_id = $1 and coach_id = $2 and role in ('HeadCoach', 'AsstCoach')",
    [teamId, viewer.coachId],
  );
  return r.rows.length > 0;
}

// Registrations eligible for team $1: same gender, and one of the team's grades or one below.
const ELIGIBLE = `
  select g.* from registrations g join teams t on t.id = $1
  where g.gender = t.gender
    and exists (select 1 from unnest(t.grades) x where (case when x = 'K' then 0 else x::int end) in (g.grade_sort, g.grade_sort + 1))`;

export type EvalCard = Fields & {
  registrantId: string;
  firstName: string;
  lastName: string;
  grade: string;
  gradeSort: number;
  registered: boolean; // still in the current registrations
  updatedBy: string | null;
  updatedAt: Date | null;
  interestedTeams: string[]; // every team that marked Interested, this one included
  rosteredOn: string[];
};

// Eligible players plus any this team already evaluated. Top grade first, then by last name. Null if not allowed.
export async function listEvaluations(deps: Deps, viewer: SessionUser, teamId: string): Promise<EvalCard[] | null> {
  if (!(await canEvaluate(deps.pool, viewer, teamId))) return null;
  const r = await deps.pool.query<EvalCard>(
    `with players as (
       select distinct on (registrant_id) * from (
         select registrant_id, first_name, last_name, grade, grade_sort, true as registered, 0 as pri from (${ELIGIBLE}) g
         union all
         select registrant_id, first_name, last_name, grade, grade_sort,
                exists (select 1 from registrations g where g.registrant_id = e.registrant_id), 1
         from evaluations e where e.team_id = $1
       ) x order by registrant_id, pri
     )
     select p.registrant_id as "registrantId", p.first_name as "firstName", p.last_name as "lastName", p.grade,
            p.grade_sort as "gradeSort", p.registered,
            e.position, e.height, e.speed, e.score, coalesce(e.notes, '') as notes, coalesce(e.interested, false) as interested,
            e.updated_by as "updatedBy", e.updated_at as "updatedAt",
            array(select t.name from evaluations i join teams t on t.id = i.team_id
                  where i.registrant_id = p.registrant_id and i.interested order by t.name) as "interestedTeams",
            array(select t.name from team_players tp join teams t on t.id = tp.team_id
                  where tp.registrant_id = p.registrant_id order by t.name) as "rosteredOn"
     from players p left join evaluations e on e.team_id = $1 and e.registrant_id = p.registrant_id
     order by p.grade_sort desc, lower(p.last_name), lower(p.first_name)`,
    [teamId],
  );
  return hideWho(deps, viewer, r.rows);
}

// Who saved a card shows only to Owners and Admins.
async function hideWho<T extends { updatedBy: string | null }>(deps: Deps, viewer: SessionUser, rows: T[]): Promise<T[]> {
  return (await seesWho(deps.pool, viewer, "thunder")) ? rows : rows.map((x) => ({ ...x, updatedBy: null }));
}

export type TeamEvalCard = { teamId: string; teamName: string; card: EvalCard };

// Director, Players page: one registered player's card for every team they can play for (same gender; the team's
// grade or one above theirs) and any other team that already rated them. Their own team first, then Comp, by grade.
export async function playerEvaluations(deps: Deps, viewer: SessionUser, registrantId: unknown): Promise<TeamEvalCard[] | null> {
  if (!hasArea(viewer, "teams") || !isRegistrant(registrantId)) return null;
  const r = await deps.pool.query<EvalCard & { teamId: string; teamName: string }>(
    `select t.id::text as "teamId", t.name as "teamName",
            g.registrant_id as "registrantId", g.first_name as "firstName", g.last_name as "lastName", g.grade,
            g.grade_sort as "gradeSort", true as registered,
            e.position, e.height, e.speed, e.score, coalesce(e.notes, '') as notes, coalesce(e.interested, false) as interested,
            e.updated_by as "updatedBy", e.updated_at as "updatedAt",
            array(select t2.name from evaluations i join teams t2 on t2.id = i.team_id
                  where i.registrant_id = g.registrant_id and i.interested order by t2.name) as "interestedTeams",
            array(select t2.name from team_players tp join teams t2 on t2.id = tp.team_id
                  where tp.registrant_id = g.registrant_id order by t2.name) as "rosteredOn"
     from registrations g cross join teams t
     left join evaluations e on e.team_id = t.id and e.registrant_id = g.registrant_id
     where g.registrant_id = $1
       and (e.team_id is not null
            or (t.gender = g.gender
                and exists (select 1 from unnest(t.grades) x where (case when x = 'K' then 0 else x::int end) in (g.grade_sort, g.grade_sort + 1))))
     order by exists (select 1 from team_players tp where tp.team_id = t.id and tp.registrant_id = g.registrant_id) desc,
              t.level = 'COMP' desc, t.grade_sort, lower(t.name)`,
    [registrantId],
  );
  return (await hideWho(deps, viewer, r.rows)).map(({ teamId, teamName, ...card }) => ({ teamId, teamName, card }));
}

// For the team page: how many players this team has rated and marked Interested.
export async function evaluationCounts(deps: Deps, teamId: string) {
  const r = await deps.pool.query<{ eligible: number; evaluated: number; interested: number }>(
    `select (select count(*)::int from (${ELIGIBLE}) g) as eligible,
            count(*)::int as evaluated, count(*) filter (where interested)::int as interested
     from evaluations where team_id = $1`,
    [teamId],
  );
  return r.rows[0];
}

// Checks one changed field. Returns the clean value, or undefined if it isn't allowed.
function clean(key: string, v: unknown): Fields[keyof Fields] | undefined {
  const oneOf = (list: readonly string[]) => (v === null || (typeof v === "string" && list.includes(v)) ? v : undefined);
  switch (key) {
    case "position":
      return oneOf(POSITIONS) as Fields["position"] | undefined;
    case "height":
      return oneOf(HEIGHTS) as Fields["height"] | undefined;
    case "speed":
      return oneOf(SPEEDS) as Fields["speed"] | undefined;
    case "score":
      return v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5) ? (v as number | null) : undefined;
    case "notes":
      return typeof v === "string" && v.trim().length <= NOTES_MAX ? v.trim() : undefined;
    case "interested":
      return typeof v === "boolean" ? v : undefined;
  }
  return undefined;
}

// Saves only the fields that changed, so two coaches rating the same player don't undo each other.
// A card with everything blank is removed.
export async function saveEvaluation(
  deps: Deps,
  viewer: SessionUser,
  teamId: unknown,
  registrantId: unknown,
  changes: unknown,
): Promise<Result<{ updatedBy: string | null; updatedAt: Date | null }>> {
  if (!isId(teamId) || !isRegistrant(registrantId))
    return { ok: false, message: "That player can't be evaluated for this team." };
  const patch: Partial<Fields> = {};
  for (const [k, v] of Object.entries(changes && typeof changes === "object" ? changes : {})) {
    const c = clean(k, v);
    if (c === undefined)
      return { ok: false, message: k === "notes" ? `Notes can be up to ${NOTES_MAX} characters.` : "That choice isn't allowed." };
    (patch as Record<string, unknown>)[k] = c;
  }
  if (!Object.keys(patch).length) return { ok: false, message: "Nothing to save." };

  return withTx(deps.pool, async (q) => {
    if (!(await canEvaluate(q, viewer, teamId))) return cantEvaluate;
    await q.query("select pg_advisory_xact_lock(hashtext('eval:' || $1 || ':' || $2))", [teamId, registrantId]);
    const old = await q.query<Fields>(
      "select position, height, speed, score, notes, interested from evaluations where team_id = $1 and registrant_id = $2",
      [teamId, registrantId],
    );
    let player = null;
    if (!old.rows[0]) {
      const p = await q.query(`select * from (${ELIGIBLE}) g where g.registrant_id = $2`, [teamId, registrantId]);
      player = p.rows[0];
      if (!player) return { ok: false as const, message: "That player isn't eligible for this team." };
    }
    const f: Fields = {
      ...{ position: null, height: null, speed: null, score: null, notes: "", interested: false },
      ...old.rows[0],
      ...patch,
    };
    if (!f.position && !f.height && !f.speed && !f.score && !f.notes && !f.interested) {
      await q.query("delete from evaluations where team_id = $1 and registrant_id = $2", [teamId, registrantId]);
      return { ok: true as const, updatedBy: null, updatedAt: null };
    }
    const by = `${viewer.firstName} ${viewer.lastName}`;
    const at = deps.now();
    const vals = [f.position, f.height, f.speed, f.score, f.notes, f.interested, by, at, teamId, registrantId];
    if (player)
      await q.query(
        `insert into evaluations (position, height, speed, score, notes, interested, updated_by, updated_at,
                                  team_id, registrant_id, first_name, last_name, gender, grade, grade_sort)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [...vals, player.first_name, player.last_name, player.gender, player.grade, player.grade_sort],
      );
    else
      await q.query(
        `update evaluations set position = $1, height = $2, speed = $3, score = $4, notes = $5, interested = $6,
                updated_by = $7, updated_at = $8
         where team_id = $9 and registrant_id = $10`,
        vals,
      );
    return { ok: true as const, updatedBy: (await seesWho(q, viewer, "thunder")) ? by : null, updatedAt: at };
  });
}
