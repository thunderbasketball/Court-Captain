// Scheduler → Bindings (SPEC.md section 13): teams an Admin or Director of Scheduling binds by hand. A binding links its
// teams like a shared coach (lib/coach-groups): all home or all away, one badge, never two games at once. It's a
// "coach" on each of its teams in TEAM_COACHES (key "b:<id>", named by its reason).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { isScheduler } from "./scenic-programs";
import { withTx } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type Binding = { id: string; reason: string | null; setBy: string; setAt: Date; teams: { id: string; name: string }[] };

const MAX_TEAMS = 10;
const REASON_MAX = 80;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const refuse = { ok: false as const, message: "Only a Scenic City Admin or Director of Scheduling can do that." };

// Every binding made by hand, newest first, each with its teams by name. Null for anyone else.
export async function listBindings(deps: Deps, viewer: SessionUser): Promise<Binding[] | null> {
  if (!(await isScheduler(deps.pool, viewer))) return null;
  const r = await deps.pool.query<Binding>(
    `select b.id::text, b.reason, b.set_by as "setBy", b.set_at as "setAt",
            coalesce((select json_agg(json_build_object('id', t.id::text, 'name', t.name) order by lower(t.name))
                        from scenic_binding_teams x join scenic_teams t on t.id = x.team_id where x.binding_id = b.id), '[]') as teams
       from scenic_bindings b order by b.set_at desc, b.id desc`,
  );
  return r.rows;
}

// Bind 2–10 teams, with an optional reason ("Same family", "Coach Lee, not in the app").
export async function bindTeams(
  deps: Deps,
  viewer: SessionUser,
  teamIds: unknown,
  reason: unknown,
): Promise<Result<{ id: string }>> {
  if (!Array.isArray(teamIds) || !teamIds.every(isId)) return { ok: false, message: "Pick the teams to bind." };
  const ids = [...new Set(teamIds as string[])];
  if (ids.length < 2) return { ok: false, message: "Pick at least two teams to bind." };
  if (ids.length > MAX_TEAMS) return { ok: false, message: `Bind at most ${MAX_TEAMS} teams at once.` };
  if (reason !== undefined && reason !== null && typeof reason !== "string") return { ok: false, message: "Check the reason." };
  const why = (reason ?? "").replace(/\s+/g, " ").trim();
  if (why.length > REASON_MAX) return { ok: false, message: `Keep the reason to ${REASON_MAX} characters.` };
  if (!(await isScheduler(deps.pool, viewer))) return refuse;
  return withTx(deps.pool, async (q) => {
    const found = await q.query("select id from scenic_teams where id = any($1::bigint[]) for share", [ids]);
    if (found.rowCount !== ids.length) return { ok: false as const, message: "A team was removed. Reload the page." };
    const b = await q.query<{ id: string }>(
      "insert into scenic_bindings (reason, set_by, set_at) values ($1, $2, $3) returning id::text",
      [why || null, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
    );
    await q.query("insert into scenic_binding_teams (binding_id, team_id) select $1, unnest($2::bigint[])", [b.rows[0].id, ids]);
    return { ok: true as const, id: b.rows[0].id };
  });
}

export async function unbind(deps: Deps, viewer: SessionUser, id: unknown): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That binding wasn't found." };
  if (!(await isScheduler(deps.pool, viewer))) return refuse;
  const r = await deps.pool.query("delete from scenic_bindings where id = $1", [id]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That binding was already removed." };
}
