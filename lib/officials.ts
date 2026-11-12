// CourtSync officials (SPEC.md section 14, step 4c): the referees a CourtSync Scheduler (e.g. Scenic City) keeps for its
// games. Its Admins and Directors of Officials add them (found by cell, or a login made) and remove them. Assigning them
// to games comes next (4c-2).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanName } from "./auth/validate";
import { hasFeature } from "./features";
import { orgHasArea } from "./org-admin";
import { isOrgSlug, type OrgSlug } from "./orgs";
import { normalizeCell } from "./phone";
import { withTx, type Queryable } from "./sql";
import { matchOrCreateUser } from "./user-match";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type Official = { id: string; name: string; cell: string; email: string | null; addedBy: string; addedAt: Date };

const NOT_ALLOWED = "Only an Admin or Director of Officials can manage officials.";

// Does this person keep the organization's officials (it has CourtSync's Scheduler side)?
export async function managesOfficials(q: Pick<Queryable, "query">, viewer: SessionUser, org: unknown): Promise<boolean> {
  if (!isOrgSlug(org) || !(await hasFeature(q, org, "officials"))) return false;
  return orgHasArea(q, viewer.coachId, org, "officials");
}

// The organization's officials, by last name; null for anyone who doesn't keep them.
export async function listOfficials(deps: Pick<Deps, "pool">, viewer: SessionUser, org: OrgSlug): Promise<Official[] | null> {
  if (!(await managesOfficials(deps.pool, viewer, org))) return null;
  const r = await deps.pool.query<Official>(
    `select u.coach_id as id, u.first_name || ' ' || u.last_name as name, u.cell, u.email,
            o.added_by as "addedBy", o.added_at as "addedAt"
       from org_officials o join users u on u.coach_id = o.coach_id
      where o.org = $1 and u.active
      order by lower(u.last_name), lower(u.first_name)`,
    [org],
  );
  return r.rows;
}

// Add an official by name and cell: the person with that cell, or a new login for them.
export async function addOfficial(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  input: { first: unknown; last: unknown; cell: unknown },
): Promise<Result<{ name: string; newLogin: boolean }>> {
  if (!(await managesOfficials(deps.pool, viewer, org))) return { ok: false, message: NOT_ALLOWED };
  const first = cleanName(input.first);
  const last = cleanName(input.last);
  const cell = typeof input.cell === "string" ? normalizeCell(input.cell) : null;
  if (!first || !last) return { ok: false, message: "Enter a first and last name (letters only)." };
  if (!cell) return { ok: false, message: "Enter a 10-digit cell number." };
  return withTx(deps.pool, async (q) => {
    const m = await matchOrCreateUser(q, { first, last, cell, email: null }, deps.now());
    if ("error" in m) return { ok: false as const, message: m.error };
    const r = await q.query(
      "insert into org_officials (org, coach_id, added_by, added_at) values ($1, $2, $3, $4) on conflict do nothing",
      [org, m.coachId, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
    );
    if (!r.rowCount) return { ok: false as const, message: `${m.who} is already one of your officials.` };
    return { ok: true as const, name: m.who, newLogin: m.newLogin };
  });
}

// Take someone off the officials list (their login stays).
export async function removeOfficial(deps: Pick<Deps, "pool">, viewer: SessionUser, org: unknown, coachId: unknown): Promise<Result> {
  if (!(await managesOfficials(deps.pool, viewer, org))) return { ok: false, message: NOT_ALLOWED };
  if (typeof coachId !== "string" || !/^\d{7}$/.test(coachId)) return { ok: false, message: "That official isn't on your list." };
  const r = await deps.pool.query("delete from org_officials where org = $1 and coach_id = $2", [org, coachId]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That official isn't on your list." };
}
