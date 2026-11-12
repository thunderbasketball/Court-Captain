// Organization Owners, Admins and Director areas (SPEC.md section 14).
// An Owner (set on the CourtCaptain page) chooses the organization's Admins. An Admin runs the organization: every area,
// and they choose its Directors and each Director's areas. Owners are also Admins; Admins are also Directors.
// A Director has one or more areas; each area covers some features. Admins also hold the Director role.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { orgFeatureKeys, orgFeatures, type Feature } from "./features";
import { isOrgSlug, type OrgSlug } from "./orgs";
import { orgShort } from "./org-registry";
import { withTx, type Queryable } from "./sql";
import { memo } from "./request-memo";
import { cleanName } from "./auth/validate";
import { normalizeCell } from "./phone";
import { matchOrCreateUser } from "./user-match";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

// One area per feature: a Director of Teams, of Practices, … (no features: every organization has it).
export const AREAS = [
  { key: "teams", name: "Teams", covers: "Teams, coaches & rosters", features: ["team-building", "team-registration"] },
  { key: "players", name: "Players", covers: "Player registrations & families", features: ["player-registration"] },
  { key: "uniforms", name: "Uniforms", covers: "Uniform numbers, sizes & orders", features: ["uniforms"] },
  {
    key: "facilities",
    name: "Facilities",
    covers: "Gyms, courts & hosting sites",
    features: ["practice", "hosting-available", "hosting-partners"],
  },
  { key: "practices", name: "Practices", covers: "Practice slots, booking limits & blackouts", features: ["practice"] },
  { key: "events", name: "Events", covers: "Open gyms, tryouts & trainings", features: ["events"] },
  { key: "programs", name: "Programs", covers: "Leagues, circuits & tournaments", features: ["programs"] },
  { key: "scheduling", name: "Scheduling", covers: "Game days: who plays when", features: ["programs"] },
  { key: "officials", name: "Officials Assigner", covers: "Assigns officials to games", features: ["officials"] },
  { key: "support", name: "Support", covers: "Answer Support chats", features: [] },
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
  // CourtCaptain staff pass too (Owner-level access to every organization, in the background).
  return memo(pool, `owner:${coachId}:${org}`, async () => {
    const r = await pool.query<{ ok: boolean }>("select acts_as($1, $2, 'Owner') as ok", [coachId, org]);
    return r.rows[0].ok;
  });
}

export async function isOrgAdmin(pool: Pick<Queryable, "query">, coachId: string, org: OrgSlug): Promise<boolean> {
  return memo(pool, `admin:${coachId}:${org}`, async () => {
    const r = await pool.query<{ ok: boolean }>("select acts_as($1, $2, 'Admin') as ok", [coachId, org]);
    return r.rows[0].ok;
  });
}

// Who did it (Added by, Rostered by, Set by, Booked by, changed by…) shows only to the organization's Owners and Admins
// (Owners also hold Admin; CourtCaptain staff pass too). It's still recorded for everyone.
export async function seesWho(
  pool: Pick<Queryable, "query">,
  viewer: Pick<SessionUser, "coachId">,
  org: OrgSlug,
): Promise<boolean> {
  return isOrgAdmin(pool, viewer.coachId, org);
}

// The areas this organization offers: those whose features it has.
export async function orgAreas(pool: Pick<Queryable, "query">, org: OrgSlug) {
  const has = await orgFeatures(pool, org);
  return AREAS.filter((a) => !a.features.length || a.features.some((f) => has.has(f)));
}

// Only CourtPlayers, CourtTeams and CourtOfficials (Directors of Officials assign) organizations have Directors (SPEC.md
// section 14); every organization has Owners and Admins. Directors added before stay until an Admin removes them.
export async function hasDirectors(pool: Pick<Queryable, "query">, org: OrgSlug): Promise<boolean> {
  const has = await orgFeatureKeys(pool, org);
  return has.has("court-players") || has.has("court-teams") || has.has("court-officials");
}

// CourtOfficials needs at least one Assigner (the officials area, given to a Director or an Admin by name). How many the
// organization has; null when it doesn't have CourtOfficials. No Assigner: Members and Staff warn.
export async function assignerCount(q: Pick<Queryable, "query">, org: OrgSlug): Promise<number | null> {
  if (!(await orgFeatureKeys(q, org)).has("court-officials")) return null;
  const r = await q.query<{ n: number }>(
    `select count(*)::int as n from director_areas a join users u on u.coach_id = a.coach_id and u.active
      where a.org = $1 and a.area = 'officials'
        and (has_role(a.coach_id, a.org, 'Director') or has_role(a.coach_id, a.org, 'Admin'))`,
    [org],
  );
  return r.rows[0].n;
}

// Admins: make someone (a Director, or an Admin or Owner too) an Assigner, or not. A Director left with no areas stops
// being a Director; an Admin keeps every area either way.
export async function setAssigner(deps: Deps, viewer: SessionUser, org: unknown, coachId: unknown, on: boolean): Promise<Result> {
  if (!isOrgSlug(org) || !isCoachId(coachId)) return { ok: false, message: "Pick a person." };
  return withTx(deps.pool, async (q) => {
    if (!(await isOrgAdmin(q, viewer.coachId, org)))
      return { ok: false as const, message: `Only a ${await orgShort(q, org)} Admin can do that.` };
    if (!(await orgFeatureKeys(q, org)).has("court-officials"))
      return { ok: false as const, message: "Assigners come with CourtOfficials." };
    const u = await q.query("select 1 from users where coach_id = $1 and active for update", [coachId]);
    if (!u.rowCount) return { ok: false as const, message: "That person isn't an active user." };
    const admin = await isOrgAdmin(q, coachId, org);
    if (on) {
      await q.query(
        `insert into director_areas (coach_id, org, area, granted_by, granted_at) values ($1, $2, 'officials', $3, $4)
         on conflict do nothing`,
        [coachId, org, by(viewer), deps.now()],
      );
      if (!admin)
        await q.query("select set_role($1, $2, 'Director', true, $3), set_role($1, $2, 'Request', false, $3)", [coachId, org, by(viewer)]);
      return { ok: true as const };
    }
    await q.query("delete from director_areas where coach_id = $1 and org = $2 and area = 'officials'", [coachId, org]);
    if (!admin) {
      const left = await q.query("select 1 from director_areas where coach_id = $1 and org = $2", [coachId, org]);
      if (!left.rowCount) await q.query("select set_role($1, $2, 'Director', false, $3)", [coachId, org, by(viewer)]);
    }
    return { ok: true as const };
  });
}

// Does this person manage any of these areas in an organization (read from the database; used for Scenic City)?
// Admins have every area; a Director needs one of them.
export async function orgHasArea(q: Pick<Queryable, "query">, coachId: string, org: OrgSlug, ...areas: Area[]): Promise<boolean> {
  return memo(q, `area:${coachId}:${org}:${[...areas].sort().join(",")}`, async () => {
    const r = await q.query(
      `select 1 where acts_as($1, $2, 'Admin')
          or (has_role($1, $2, 'Director') and exists (select 1 from director_areas where coach_id = $1 and org = $2 and area = any($3::text[])))`,
      [coachId, org, areas],
    );
    return r.rowCount === 1;
  });
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

export type DirectorRow = { id: string; name: string; cell: string; owner: boolean; admin: boolean; areas: Area[] };

// An organization's Admins and Directors (by last name) with their areas.
export async function listDirectors(pool: Pick<Queryable, "query">, org: OrgSlug): Promise<DirectorRow[]> {
  const r = await pool.query<DirectorRow>(
    `select u.coach_id as id, u.first_name || ' ' || u.last_name as name, u.cell,
            has_role(u.coach_id, $1, 'Owner') as owner, has_role(u.coach_id, $1, 'Admin') as admin,
            array(select area from director_areas a where a.coach_id = u.coach_id and a.org = $1) as areas
     from users u
     where (has_role(u.coach_id, $1, 'Director') or has_role(u.coach_id, $1, 'Admin'))
       and not exists (select 1 from platform_admins p where p.coach_id = u.coach_id) -- CourtCaptain staff stay in the background
     order by lower(u.last_name), lower(u.first_name)`,
    [org],
  );
  return r.rows;
}

// What an organization's Users page shows to its Admins: Directors, the areas on offer, and who can be added.
export async function directorsPanel(deps: Deps, viewer: SessionUser, org: OrgSlug) {
  if (!(await isOrgAdmin(deps.pool, viewer.coachId, org))) return null;
  const [directors, areas, people, owner, directorsOn] = await Promise.all([
    listDirectors(deps.pool, org),
    orgAreas(deps.pool, org),
    deps.pool.query<{ id: string; name: string }>(
      `select coach_id as id, first_name || ' ' || last_name as name from users
       where active and not has_role(coach_id, $1, 'Director') and not has_role(coach_id, $1, 'Admin')
         and not exists (select 1 from platform_admins p where p.coach_id = users.coach_id)
         -- Only this organization's people: a role there (a request too), or a place on one of its teams.
         and (exists (select 1 from org_roles r where r.coach_id = users.coach_id and r.org = $1)
              or ($1 = 'thunder' and exists (select 1 from team_staff s where s.coach_id = users.coach_id))
              or exists (select 1 from org_team_coaches c join org_teams t on t.id = c.team_id
                         where c.coach_id = users.coach_id and t.org = $1))
       order by lower(last_name), lower(first_name)`,
      [org],
    ),
    isOrgOwner(deps.pool, viewer.coachId, org),
    hasDirectors(deps.pool, org),
  ]);
  // Only areas this organization offers (an old area that moved to a new one isn't shown).
  const offered = new Set<string>(areas.map((a) => a.key));
  return {
    directors: directors.map((d) => ({ ...d, areas: d.areas.filter((a) => offered.has(a)) })),
    areas: areas.map((a) => ({ key: a.key, name: a.name, covers: a.covers })),
    options: people.rows,
    directorsOn, // CourtPlayers or CourtTeams: Admins add Directors
    // Owners also choose Admins (anyone active who isn't one yet, Directors included) and other Owners (Admins too).
    canManageAdmins: owner,
    ownerOptions: owner
      ? [...people.rows, ...directors.filter((d) => !d.owner).map((d) => ({ id: d.id, name: d.name }))].sort((a, b) =>
          a.name.localeCompare(b.name),
        )
      : [],
    adminOptions: owner
      ? [...people.rows, ...directors.filter((d) => !d.admin).map((d) => ({ id: d.id, name: d.name }))].sort((a, b) =>
          a.name.localeCompare(b.name),
        )
      : [],
  };
}

// Owners: make someone another Owner (also Admin and Director, every area), or take Owner away (they stay an Admin).
// Every organization keeps at least one Owner.
export async function setOwner(deps: Deps, viewer: SessionUser, org: unknown, coachId: unknown, on: boolean): Promise<Result> {
  if (!isOrgSlug(org) || !isCoachId(coachId)) return { ok: false, message: "Pick a person." };
  return withTx(deps.pool, async (q) => {
    // One change per organization at a time, so two removals can't leave it with no Owner.
    if (!(await q.query("select 1 from organizations where slug = $1 for update", [org])).rowCount)
      return { ok: false as const, message: "That organization no longer exists." };
    if (!(await isOrgOwner(q, viewer.coachId, org)))
      return { ok: false as const, message: `Only a ${await orgShort(q, org)} Owner can do that.` };
    const u = await q.query("select 1 from users where coach_id = $1 and active", [coachId]);
    if (!u.rowCount) return { ok: false as const, message: "That person isn't an active user." };
    if (on) {
      await q.query(
        `select set_role($1, $2, 'Owner', true, $3), set_role($1, $2, 'Admin', true, $3), set_role($1, $2, 'Director', true, $3),
                set_role($1, $2, 'Request', false, $3)`,
        [coachId, org, by(viewer)],
      );
      return { ok: true as const };
    }
    const others = await q.query<{ n: number }>(
      `select count(*)::int as n from org_roles r where r.org = $1 and r.role = 'Owner' and r.coach_id <> $2
       and not exists (select 1 from platform_admins p where p.coach_id = r.coach_id)`,
      [org, coachId],
    );
    if (others.rows[0].n === 0) return { ok: false as const, message: `${await orgShort(q, org)} needs at least one Owner.` };
    await q.query("select set_role($1, $2, 'Owner', false, $3)", [coachId, org, by(viewer)]);
    return { ok: true as const };
  });
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
      return { ok: false as const, message: `Only a ${await orgShort(q, org)} Admin can do that.` };
    const u = await q.query("select 1 from users where coach_id = $1 and active for update", [coachId]);
    if (!u.rowCount) return { ok: false as const, message: "That person isn't an active user." };
    if (await isOrgAdmin(q, coachId, org)) return { ok: false as const, message: "Admins have every area." };
    if (want.length && !(await hasDirectors(q, org)))
      return { ok: false as const, message: "Directors come with CourtPlayers, CourtTeams or CourtOfficials. Your Owners and Admins run everything." };
    const offered = new Set<string>((await orgAreas(q, org)).map((a) => a.key));
    if (!want.every((a) => offered.has(a)))
      return { ok: false as const, message: `${await orgShort(q, org)} doesn't have that area.` };
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
      return { ok: false as const, message: `Only a ${await orgShort(q, org)} Owner can do that.` };
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

// Admins: a new person to make an Owner, Admin or Director (first, last, cell): their login is found by cell or made
// (starter PIN 1234). The role itself is then given with setOwner, setAdmin or setDirectorAreas.
export async function addPersonFor(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  input: { first: unknown; last: unknown; cell: unknown },
): Promise<Result<{ coachId: string; name: string; newLogin: boolean }>> {
  if (!isOrgSlug(org) || !(await isOrgAdmin(deps.pool, viewer.coachId, org)))
    return { ok: false, message: "Only an Admin of this organization can add people." };
  const first = cleanName(input.first);
  const last = cleanName(input.last);
  const cell = typeof input.cell === "string" ? normalizeCell(input.cell) : null;
  if (!first || !last) return { ok: false, message: "Enter a first and last name (letters only)." };
  if (!cell) return { ok: false, message: "Enter a 10-digit cell number." };
  return withTx(deps.pool, async (q) => {
    const m = await matchOrCreateUser(q, { first, last, cell, email: null }, deps.now());
    if ("error" in m) return { ok: false as const, message: m.error };
    return { ok: true as const, coachId: m.coachId, name: m.who, newLogin: m.newLogin };
  });
}
