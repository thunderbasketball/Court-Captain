// Uniforms (team page → Uniforms tab). For each rostered player the team's staff set a number, unique on the team,
// and a size for players who need a uniform: their family ordered one at registration, or the team's staff ticked
// "Needs a uniform". Those ticked show on Home for the Director of Uniforms to add to the TeamSnap order (Added, or
// the sheet showing the order, takes them off). The parent's requested size and number show as a hint only. Anything
// missing makes the Uniforms tab flash red.
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
            (coalesce(g.uniform_needed, false) or u.needs_uniform_at is not null) as ordered,
            coalesce(g.uniform_needed, false) as registered, u.needs_uniform_by as "neededBy", u.order_added_by as "addedBy",
            g.uniform_size as "askedSize", g.uniform_number as "askedNumber",
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
     where p.team_id = $1 and (u.number is null or ((coalesce(g.uniform_needed, false) or u.needs_uniform_at is not null) and u.size is null))`,
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
    if (!(await canSeeRoster(q, viewer, teamId)))
      return { ok: false as const, message: "Only this team's staff can set uniforms." };
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

export type UniformOrder = {
  teamId: string;
  team: string;
  registrantId: string;
  lastName: string;
  number: string | null;
  size: string | null;
};

// Director only: every rostered player who needs a uniform (ordered, or ticked by their coach), by team (same order as the Teams page), then last name.
export async function listUniformOrders(deps: Deps, viewer: SessionUser): Promise<UniformOrder[]> {
  if (!hasArea(viewer, "uniforms")) throw new Error("Director only");
  const r = await deps.pool.query<UniformOrder>(
    `select t.id::text as "teamId", t.name as team, p.registrant_id as "registrantId", p.last_name as "lastName", u.number, u.size
     from team_players p
     join teams t on t.id = p.team_id
     left join registrations g on g.registrant_id = p.registrant_id
     left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
     where coalesce(g.uniform_needed, false) or u.needs_uniform_at is not null
     order by t.level = 'COMP' desc, t.gender, t.grade_sort, lower(t.name), lower(p.last_name), lower(p.first_name)`,
  );
  return r.rows;
}

// The team's staff (or a Director of Teams): tick "Needs a uniform" for a player whose family didn't order one at
// registration, or untick it. Once it's on the TeamSnap order only a Director of Uniforms can untick it.
export async function setNeedsUniform(
  deps: Deps,
  viewer: SessionUser,
  teamId: unknown,
  registrantId: unknown,
  on: unknown,
): Promise<Result<{ by: string }>> {
  if (!isId(teamId) || !isRegistrant(registrantId)) return { ok: false, message: "That player isn't on this team." };
  return withTx(deps.pool, async (q) => {
    if (!(await canSeeRoster(q, viewer, teamId)))
      return { ok: false as const, message: "Only this team's staff can set uniforms." };
    await q.query("select pg_advisory_xact_lock(hashtext('uniform:' || $1))", [teamId]);
    const p = await q.query<{ registered: boolean; added: string | null }>(
      `select coalesce(g.uniform_needed, false) as registered, u.order_added_by as added
       from team_players p
       left join registrations g on g.registrant_id = p.registrant_id
       left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
       where p.team_id = $1 and p.registrant_id = $2`,
      [teamId, registrantId],
    );
    if (!p.rows[0]) return { ok: false as const, message: "That player isn't on this team." };
    if (p.rows[0].registered) return { ok: false as const, message: "Their family already ordered a uniform." };
    if (on !== true && p.rows[0].added && !hasArea(viewer, "uniforms"))
      return {
        ok: false as const,
        message: `It's already on the TeamSnap order (added by ${p.rows[0].added}). Ask the Director of Uniforms.`,
      };
    const by = `${viewer.firstName} ${viewer.lastName}`;
    const at = deps.now();
    if (on === true)
      await q.query(
        `insert into team_uniforms (team_id, registrant_id, updated_by, updated_at, needs_uniform_by, needs_uniform_at)
         values ($1, $2, $3, $4, $3, $4)
         on conflict (team_id, registrant_id) do update set
           needs_uniform_by = coalesce(team_uniforms.needs_uniform_by, excluded.needs_uniform_by),
           needs_uniform_at = coalesce(team_uniforms.needs_uniform_at, excluded.needs_uniform_at),
           updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        [teamId, registrantId, by, at],
      );
    else
      await q.query(
        `update team_uniforms set needs_uniform_by = null, needs_uniform_at = null, order_added_by = null, order_added_at = null,
                size = null, updated_by = $3, updated_at = $4
         where team_id = $1 and registrant_id = $2`,
        [teamId, registrantId, by, at],
      );
    return { ok: true as const, by };
  });
}

export type UniformRequest = {
  teamId: string;
  team: string;
  registrantId: string;
  firstName: string;
  lastName: string;
  number: string | null;
  size: string | null;
  neededBy: string;
  neededAt: Date;
};

// Directors of Uniforms (Home): players their coaches said need a uniform that aren't on the TeamSnap order yet, by team
// (Teams page order), then last name. Off the list once marked Added, or once the sheet shows them ordering one.
export async function uniformRequests(deps: Deps, viewer: SessionUser): Promise<UniformRequest[] | null> {
  if (!hasArea(viewer, "uniforms")) return null;
  const r = await deps.pool.query<UniformRequest>(
    `select t.id::text as "teamId", t.name as team, p.registrant_id as "registrantId", p.first_name as "firstName",
            p.last_name as "lastName", u.number, u.size, u.needs_uniform_by as "neededBy", u.needs_uniform_at as "neededAt"
     from team_uniforms u
     join team_players p on p.team_id = u.team_id and p.registrant_id = u.registrant_id
     join teams t on t.id = u.team_id
     left join registrations g on g.registrant_id = u.registrant_id
     where u.needs_uniform_at is not null and u.order_added_at is null and not coalesce(g.uniform_needed, false)
     order by t.level = 'COMP' desc, t.gender, t.grade_sort, lower(t.name), lower(p.last_name), lower(p.first_name)`,
  );
  return r.rows;
}

// Directors of Uniforms: this player's uniform is on the TeamSnap order now (they need a size first). Who did it is kept.
export async function markUniformAdded(deps: Deps, viewer: SessionUser, teamId: unknown, registrantId: unknown): Promise<Result> {
  if (!hasArea(viewer, "uniforms")) return { ok: false, message: "Only the Director of Uniforms can do this." };
  if (!isId(teamId) || !isRegistrant(registrantId)) return { ok: false, message: "That player isn't on this team." };
  return withTx(deps.pool, async (q) => {
    const u = await q.query<{ size: string | null }>(
      `select u.size from team_uniforms u join team_players p on p.team_id = u.team_id and p.registrant_id = u.registrant_id
       where u.team_id = $1 and u.registrant_id = $2 and u.needs_uniform_at is not null for update of u`,
      [teamId, registrantId],
    );
    if (!u.rows[0]) return { ok: false as const, message: "Their coach no longer says they need a uniform." };
    if (!u.rows[0].size)
      return { ok: false as const, message: "They need a size first (their coach sets it on the team's Uniforms tab)." };
    await q.query("update team_uniforms set order_added_by = $3, order_added_at = $4 where team_id = $1 and registrant_id = $2", [
      teamId,
      registrantId,
      `${viewer.firstName} ${viewer.lastName}`,
      deps.now(),
    ]);
    return { ok: true as const };
  });
}
