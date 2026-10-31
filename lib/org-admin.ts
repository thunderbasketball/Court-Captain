// Organization Owners, Admins and Director areas (SPEC.md section 14).
// An Owner (set on the CourtCaptain page) chooses the organization's Admins. An Admin runs the organization: every area,
// and they choose its Directors and each Director's areas. Owners are also Admins; Admins are also Directors.
// A Director has one or more areas; each area covers some features. Admins also hold the Director role.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { orgFeatures, type Feature } from "./features";
import { ORGS, isOrgSlug, type OrgSlug } from "./orgs";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };

export const AREAS = [
  { key: "players", name: "Players", covers: "Player Registration & Uniforms", features: ["player-registration", "uniforms"] },
  { key: "teams", name: "Teams", covers: "Team Registrations & Rosters", features: ["team-registration", "team-building"] },
  {
    key: "coaches",
    name: "Coaches",
    covers: "Coach contacts & volunteer coaches",
    features: ["team-building", "team-registration"],
  },
  { key: "facilities", name: "Facilities", covers: "Practice & game locations", features: ["practice", "hosting-partners"] },
  { key: "programs", name: "Programs", covers: "Events, Leagues, Circuits & Tournaments", features: ["events", "programs"] },
  { key: "officials", name: "Officials", covers: "Officials for games", features: ["officials"] },
] as const satisfies readonly { key: string; name: string; covers: string; features: readonly Feature[] }[];

export type Area = (typeof AREAS)[number]["key"];
const isArea = (v: unknown): v is Area => AREAS.some((a) => a.key === v);
const isCoachId = (v: unknown): v is string => typeof v === "string" && /^\d{7}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

// Can this person manage any of these Thunder areas? A Director with one of them, or an Admin (who has them all).
// A session built outside login (tests) without areas counts as having every area.
export function hasArea(viewer: Pick<SessionUser, "isDirector" | "thunderAreas">, ...areas: Area[]): boolean {
  const mine = viewer.thunderAreas ?? AREAS.map((a) => a.key);
  return viewer.isDirector && areas.some((a) => mine.includes(a));
}

// Thunder Admin (Users, view as someone). A session built outside login (tests) without areas counts as an Admin.
export function isThunderAdmin(viewer: Pick<SessionUser, "isDirector" | "isAdmin" | "thunderAreas">): boolean {
  return viewer.isDirector && (viewer.isAdmin ?? viewer.thunderAreas === undefined);
}

export async function isOrgOwner(pool: Pick<Queryable, "query">, coachId: string, org: OrgSlug): Promise<boolean> {
  const r = await pool.query("select 1 from org_roles where coach_id = $1 and org = $2 and role = 'Owner'", [coachId, org]);
  return r.rowCount === 1;
}

export async function isOrgAdmin(pool: Pick<Queryable, "query">, coachId: string, org: OrgSlug): Promise<boolean> {
  const r = await pool.query("select 1 from org_roles where coach_id = $1 and org = $2 and role = 'Admin'", [coachId, org]);
  return r.rowCount === 1;
}

// The areas this organization offers: those whose features it has.
export async function orgAreas(pool: Pick<Queryable, "query">, org: OrgSlug) {
  const has = await orgFeatures(pool, org);
  return AREAS.filter((a) => a.features.some((f) => has.has(f)));
}

// Does this person manage any of these areas in an organization (read from the database; used for Scenic City)?
// Admins have every area; a Director needs one of them.
export async function orgHasArea(q: Pick<Queryable, "query">, coachId: string, org: OrgSlug, ...areas: Area[]): Promise<boolean> {
  const r = await q.query(
    `select 1 where has_role($1, $2, 'Admin')
        or (has_role($1, $2, 'Director') and exists (select 1 from director_areas where coach_id = $1 and org = $2 and area = any($3::text[])))`,
    [coachId, org, areas],
  );
  return r.rowCount === 1;
}

// A person's areas in an organization. Admins have every area the organization offers.
export async function directorAreas(pool: Pick<Queryable, "query">, coachId: string, org: OrgSlug): Promise<Area[]> {
  if (await isOrgAdmin(pool, coachId, org)) return (await orgAreas(pool, org)).map((a) => a.key);
  const r = await pool.query<{ area: Area }>(
    `select a.area from director_areas a where a.coach_id = $1 and a.org = $2 and has_role(a.coach_id, a.org, 'Director')`,
    [coachId, org],
  );
  return AREAS.map((a) => a.key).filter((k) => r.rows.some((x) => x.area === k));
}

export type DirectorRow = { id: string; name: string; owner: boolean; admin: boolean; areas: Area[] };

// An organization's Admins and Directors (by last name) with their areas.
export async function listDirectors(pool: Pick<Queryable, "query">, org: OrgSlug): Promise<DirectorRow[]> {
  const r = await pool.query<DirectorRow>(
    `select u.coach_id as id, u.first_name || ' ' || u.last_name as name,
            has_role(u.coach_id, $1, 'Owner') as owner, has_role(u.coach_id, $1, 'Admin') as admin,
            array(select area from director_areas a where a.coach_id = u.coach_id and a.org = $1) as areas
     from users u
     where has_role(u.coach_id, $1, 'Director') or has_role(u.coach_id, $1, 'Admin')
     order by lower(u.last_name), lower(u.first_name)`,
    [org],
  );
  return r.rows;
}

// What an organization's Users page shows to its Admins: Directors, the areas on offer, and who can be added.
export async function directorsPanel(deps: Deps, viewer: SessionUser, org: OrgSlug) {
  if (!(await isOrgAdmin(deps.pool, viewer.coachId, org))) return null;
  const [directors, areas, people, owner] = await Promise.all([
    listDirectors(deps.pool, org),
    orgAreas(deps.pool, org),
    deps.pool.query<{ id: string; name: string }>(
      `select coach_id as id, first_name || ' ' || last_name as name from users
       where active and not has_role(coach_id, $1, 'Director') and not has_role(coach_id, $1, 'Admin')
       order by lower(last_name), lower(first_name)`,
      [org],
    ),
    isOrgOwner(deps.pool, viewer.coachId, org),
  ]);
  return {
    directors,
    areas: areas.map((a) => ({ key: a.key, name: a.name, covers: a.covers })),
    options: people.rows,
    // Owners also choose Admins: from anyone active who isn't an Admin yet (Directors included).
    canManageAdmins: owner,
    adminOptions: owner
      ? [...people.rows, ...directors.filter((d) => !d.admin).map((d) => ({ id: d.id, name: d.name }))].sort((a, b) =>
          a.name.localeCompare(b.name),
        )
      : [],
  };
}

// Admins only: give a person the Director role with these areas, or (no areas) take the Director role away.
// An Admin's Director role and areas aren't changed here (Admins have every area; Owners manage Admins).
export async function setDirectorAreas(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  coachId: unknown,
  areas: unknown,
): Promise<Result> {
  if (!isOrgSlug(org) || !isCoachId(coachId)) return { ok: false, message: "Pick a person." };
  const want = Array.isArray(areas) ? [...new Set(areas)] : [];
  if (!want.every(isArea)) return { ok: false, message: "Pick areas from the list." };
  return withTx(deps.pool, async (q) => {
    if (!(await isOrgAdmin(q, viewer.coachId, org)))
      return { ok: false as const, message: `Only a ${ORGS[org].short} Admin can do that.` };
    const u = await q.query("select 1 from users where coach_id = $1 and active for update", [coachId]);
    if (!u.rowCount) return { ok: false as const, message: "That person isn't an active user." };
    if (await isOrgAdmin(q, coachId, org)) return { ok: false as const, message: "Admins have every area." };
    const offered = new Set<string>((await orgAreas(q, org)).map((a) => a.key));
    if (!want.every((a) => offered.has(a))) return { ok: false as const, message: `${ORGS[org].short} doesn't have that area.` };
    await q.query("delete from director_areas where coach_id = $1 and org = $2", [coachId, org]);
    for (const area of want)
      await q.query("insert into director_areas (coach_id, org, area, granted_by, granted_at) values ($1, $2, $3, $4, $5)", [
        coachId,
        org,
        area,
        by(viewer),
        deps.now(),
      ]);
    await q.query("select set_role($1, $2, 'Director', $3, $4)", [coachId, org, want.length > 0, by(viewer)]);
    if (want.length) await q.query("select set_role($1, $2, 'Request', false, $3)", [coachId, org, by(viewer)]);
    return { ok: true as const };
  });
}

// Owners only: make someone an Admin of the organization (they also get Director; their Request there is cleared),
// or take Admin away (they stay a Director, with no areas until an Admin gives them some). An Owner's Admin stays:
// Owners are changed on the CourtCaptain page.
export async function setAdmin(deps: Deps, viewer: SessionUser, org: unknown, coachId: unknown, on: boolean): Promise<Result> {
  if (!isOrgSlug(org) || !isCoachId(coachId)) return { ok: false, message: "Pick a person." };
  return withTx(deps.pool, async (q) => {
    if (!(await isOrgOwner(q, viewer.coachId, org)))
      return { ok: false as const, message: `Only a ${ORGS[org].short} Owner can do that.` };
    const u = await q.query("select 1 from users where coach_id = $1 and active for update", [coachId]);
    if (!u.rowCount) return { ok: false as const, message: "That person isn't an active user." };
    if (!on && (await isOrgOwner(q, coachId, org))) return { ok: false as const, message: "Owners are always Admins." };
    if (on)
      await q.query(
        "select set_role($1, $2, 'Admin', true, $3), set_role($1, $2, 'Director', true, $3), set_role($1, $2, 'Request', false, $3)",
        [coachId, org, by(viewer)],
      );
    else await q.query("select set_role($1, $2, 'Admin', false, $3)", [coachId, org, by(viewer)]);
    return { ok: true as const };
  });
}
