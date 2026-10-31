// Uniforms (team page → Uniforms tab). For each rostered player the team's staff set a number, unique on the team,
// and a size for players whose family ordered a uniform at registration. The parent's requested size and number
// show as a hint only. Anything missing makes the Uniforms tab flash red.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { canSeeRoster } from "./rosters";
import { withTx } from "./sql";
import { SIZES, type UniformRow } from "./uniform-fields";
import { hasArea } from "./org-admin";

export { SIZES, duplicateNumbers, isMissing, jerseyName, type UniformRow } from "./uniform-fields";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const isRegistrant = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,40}$/.test(v);

// The team's rostered players, by last name. Null when the viewer can't see this team.
export async function listUniforms(deps: Deps, viewer: SessionUser, teamId: string): Promise<UniformRow[] | null> {
  if (!isId(teamId) || !(await canSeeRoster(deps.pool, viewer, teamId))) return null;
  const r = await deps.pool.query<UniformRow>(
    `select p.registrant_id as "registrantId", p.first_name as "firstName", p.last_name as "lastName", p.grade,
            coalesce(g.uniform_needed, false) as ordered, g.uniform_size as "askedSize", g.uniform_number as "askedNumber",
            u.number, u.size, u.updated_by as "updatedBy", u.updated_at as "updatedAt"
     from team_players p
     left join registrations g on g.registrant_id = p.registrant_id
     left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
     where p.team_id = $1
     order by lower(p.last_name), lower(p.first_name)`,
    [teamId],
  );
  return r.rows;
}

// How many rostered players still need a number or size (for the flashing tab).
export async function uniformsMissing(deps: Deps, teamId: string): Promise<number> {
  const r = await deps.pool.query<{ n: number }>(
    `select count(*)::int as n from team_players p
     left join registrations g on g.registrant_id = p.registrant_id
     left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
     where p.team_id = $1 and (u.number is null or (coalesce(g.uniform_needed, false) and u.size is null))`,
    [teamId],
  );
  return r.rows[0].n;
}

// Sets one player's number and/or size (only the fields given; null clears). Any of the team's staff or a Director.
// Returns the team's duplicate numbers so the page can warn; a duplicate is allowed but flagged.
export async function saveUniform(
  deps: Deps,
  viewer: SessionUser,
  teamId: unknown,
  registrantId: unknown,
  changes: { number?: unknown; size?: unknown },
): Promise<Result<{ updatedBy: string; updatedAt: Date; duplicates: string[] }>> {
  if (!isId(teamId) || !isRegistrant(registrantId)) return { ok: false, message: "That player isn't on this team." };
  const patch: { number?: string | null; size?: string | null } = {};
  if ("number" in changes) {
    const n = typeof changes.number === "string" ? changes.number.trim() : changes.number;
    if (n !== null && n !== "" && !(typeof n === "string" && /^\d{1,2}$/.test(n)))
      return { ok: false, message: "A uniform number is 0 to 99." };
    // "07" is the same jersey as "7"; "0" and "00" are different jerseys.
    patch.number = n ? (n === "00" ? n : String(Number(n))) : null;
  }
  if ("size" in changes) {
    const s = changes.size;
    if (s !== null && s !== "" && !(typeof s === "string" && (SIZES as readonly string[]).includes(s)))
      return { ok: false, message: "Pick a size from the list." };
    patch.size = s ? (s as string) : null;
  }
  if (!("number" in patch) && !("size" in patch)) return { ok: false, message: "Nothing to save." };

  return withTx(deps.pool, async (q) => {
    if (!(await canSeeRoster(q, viewer, teamId))) return { ok: false as const, message: "Only this team's staff can set uniforms." };
    await q.query("select pg_advisory_xact_lock(hashtext('uniform:' || $1))", [teamId]);
    const on = await q.query("select 1 from team_players where team_id = $1 and registrant_id = $2", [teamId, registrantId]);
    if (!on.rows[0]) return { ok: false as const, message: "That player isn't on this team." };
    const by = `${viewer.firstName} ${viewer.lastName}`;
    const at = deps.now();
    await q.query(
      `insert into team_uniforms (team_id, registrant_id, number, size, updated_by, updated_at) values ($1, $2, $3, $4, $5, $6)
       on conflict (team_id, registrant_id) do update set
         number = case when $7 then excluded.number else team_uniforms.number end,
         size = case when $8 then excluded.size else team_uniforms.size end,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [teamId, registrantId, patch.number ?? null, patch.size ?? null, by, at, "number" in patch, "size" in patch],
    );
    const d = await q.query<{ number: string }>(
      `select u.number from team_uniforms u join team_players p on p.team_id = u.team_id and p.registrant_id = u.registrant_id
       where u.team_id = $1 and u.number is not null group by u.number having count(*) > 1 order by u.number`,
      [teamId],
    );
    return { ok: true as const, updatedBy: by, updatedAt: at, duplicates: d.rows.map((x) => x.number) };
  });
}

export type UniformOrder = { teamId: string; team: string; registrantId: string; lastName: string; number: string | null; size: string | null };

// Director only: every rostered player whose family ordered a uniform, by team (same order as the Teams page), then last name.
export async function listUniformOrders(deps: Deps, viewer: SessionUser): Promise<UniformOrder[]> {
  if (!hasArea(viewer, "players")) throw new Error("Director only");
  const r = await deps.pool.query<UniformOrder>(
    `select t.id::text as "teamId", t.name as team, p.registrant_id as "registrantId", p.last_name as "lastName", u.number, u.size
     from team_players p
     join teams t on t.id = p.team_id
     join registrations g on g.registrant_id = p.registrant_id and g.uniform_needed
     left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
     order by t.level = 'COMP' desc, t.gender, t.grade_sort, lower(t.name), lower(p.last_name), lower(p.first_name)`,
  );
  return r.rows;
}
