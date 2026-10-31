// CourtCaptain Admins run the platform (SPEC.md section 14): every organization, its features and its Owners.
// Admins and Directors are shown but chosen inside each organization (Owners choose Admins; Admins choose Directors).
// The admin role belongs to no organization; it's re-read from `platform_admins` on every request.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { FEATURES, type Feature } from "./features";
import { listDirectors, type DirectorRow } from "./org-admin";
import { ORGS, ORG_SLUGS, isOrgSlug, type OrgSlug } from "./orgs";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };

const adminOnly = "Only a CourtCaptain Admin can do that.";
const isCoachId = (v: unknown): v is string => typeof v === "string" && /^\d{7}$/.test(v);

export async function isPlatformAdmin(pool: Pick<Queryable, "query">, coachId: string): Promise<boolean> {
  const r = await pool.query("select 1 from platform_admins where coach_id = $1", [coachId]);
  return r.rowCount === 1;
}

export type PlatformOrg = {
  slug: OrgSlug;
  name: string;
  features: { key: Feature; name: string; on: boolean; always: boolean; source: string | null; since: Date | null }[];
  owners: { id: string; name: string }[];
  admins: { id: string; name: string }[]; // Admins who aren't Owners (shown; Owners choose them)
  directors: DirectorRow[]; // Directors who aren't Admins, with their areas (shown; Admins choose them)
  options: { id: string; name: string }[]; // active users who aren't its Owners yet
};

// Everything on the CourtCaptain page; null for anyone who isn't an admin.
export async function platformOverview(
  deps: Deps,
  viewer: SessionUser,
): Promise<{ orgs: PlatformOrg[]; platformAdmins: { id: string; name: string }[] } | null> {
  if (!(await isPlatformAdmin(deps.pool, viewer.coachId))) return null;
  const [feats, users, admins, ...people] = await Promise.all([
    deps.pool.query<{ org: string; feature: string; source: string; turned_on_at: Date }>(
      "select org, feature, source, turned_on_at from org_features",
    ),
    deps.pool.query<{ id: string; name: string }>(
      `select coach_id as id, first_name || ' ' || last_name as name from users where active
       order by lower(last_name), lower(first_name)`,
    ),
    deps.pool.query<{ id: string; name: string }>(
      `select u.coach_id as id, u.first_name || ' ' || u.last_name as name from platform_admins a
       join users u using (coach_id) order by lower(u.last_name), lower(u.first_name)`,
    ),
    ...ORG_SLUGS.map((o) => listDirectors(deps.pool, o)),
  ]);
  const orgs = ORG_SLUGS.map((slug, i): PlatformOrg => {
    const mine = new Map(feats.rows.filter((f) => f.org === slug).map((f) => [f.feature, f]));
    const team = people[i];
    const ownerIds = new Set(team.filter((d) => d.owner).map((d) => d.id));
    return {
      slug,
      name: ORGS[slug].name,
      features: FEATURES.map((f) => {
        const always = "always" in f && f.always;
        const row = mine.get(f.key);
        return {
          key: f.key,
          name: f.name,
          on: always || !!row,
          always,
          source: row?.source ?? null,
          since: row?.turned_on_at ?? null,
        };
      }),
      owners: team.filter((d) => d.owner).map((d) => ({ id: d.id, name: d.name })),
      admins: team.filter((d) => d.admin && !d.owner).map((d) => ({ id: d.id, name: d.name })),
      directors: team.filter((d) => !d.admin),
      options: users.rows.filter((u) => !ownerIds.has(u.id)),
    };
  });
  return { orgs, platformAdmins: admins.rows };
}

// Turn a feature on (free: "comp", until upgrades are paid for) or off for an organization. Alerts can't be turned off.
export async function setOrgFeature(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  feature: unknown,
  on: boolean,
): Promise<Result> {
  if (!(await isPlatformAdmin(deps.pool, viewer.coachId))) return { ok: false, message: adminOnly };
  const f = FEATURES.find((x) => x.key === feature);
  if (!isOrgSlug(org) || !f) return { ok: false, message: "Pick an organization and a feature." };
  if ("always" in f && f.always) return { ok: false, message: `${f.name} comes with every organization.` };
  if (on)
    await deps.pool.query(
      `insert into org_features (org, feature, source, turned_on_by, turned_on_at) values ($1, $2, 'comp', $3, $4)
       on conflict (org, feature) do nothing`,
      [org, f.key, viewer.coachId, deps.now()],
    );
  else await deps.pool.query("delete from org_features where org = $1 and feature = $2", [org, f.key]);
  return { ok: true };
}

// Make someone an Owner of an organization (they also get Admin and Director, and their Request there is cleared),
// or take Owner away (they stay an Admin). Every organization keeps at least one Owner.
export async function setOrgOwner(deps: Deps, viewer: SessionUser, org: unknown, coachId: unknown, on: boolean): Promise<Result> {
  if (!(await isPlatformAdmin(deps.pool, viewer.coachId))) return { ok: false, message: adminOnly };
  if (!isOrgSlug(org) || !isCoachId(coachId)) return { ok: false, message: "Pick an organization and a person." };
  return withTx(deps.pool, async (q) => {
    // One change per organization at a time, so two removals can't leave it with no Owner.
    await q.query("select 1 from organizations where slug = $1 for update", [org]);
    const u = await q.query("select 1 from users where coach_id = $1 and active", [coachId]);
    if (!u.rowCount) return { ok: false as const, message: "That person isn't an active user." };
    const who = `${viewer.firstName} ${viewer.lastName}`;
    if (on) {
      await q.query(
        `select set_role($1, $2, 'Owner', true, $3), set_role($1, $2, 'Admin', true, $3), set_role($1, $2, 'Director', true, $3),
                set_role($1, $2, 'Request', false, $3)`,
        [coachId, org, who],
      );
      return { ok: true as const };
    }
    const n = await q.query<{ n: number }>(
      "select count(*)::int as n from org_roles where org = $1 and role = 'Owner' and coach_id <> $2",
      [org, coachId],
    );
    if (n.rows[0].n === 0) return { ok: false as const, message: `${ORGS[org].name} needs at least one Owner.` };
    await q.query("select set_role($1, $2, 'Owner', false, $3)", [coachId, org, who]);
    return { ok: true as const };
  });
}
