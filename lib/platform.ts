// CourtCaptain Admins run the platform (SPEC.md section 14): every organization, its features and its Owners.
// Admins and Directors are shown but chosen inside each organization (Owners choose Admins; Admins choose Directors).
// The admin role belongs to no organization; it's re-read from `platform_admins` on every request.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { FEATURES, READY_FOR_ANY_ORG, type Feature } from "./features";
import { listDirectors, type DirectorRow } from "./org-admin";
import { BUILT_IN, isOrgSlug, type OrgSlug } from "./orgs";
import { listOrgs, orgInfo, orgName } from "./org-registry";
import { withTx, type Queryable } from "./sql";
import { TZ } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };

const adminOnly = "Only a CourtCaptain Admin can do that.";
const isCoachId = (v: unknown): v is string => typeof v === "string" && /^\d{7}$/.test(v);

export async function isPlatformAdmin(pool: Pick<Queryable, "query">, coachId: string): Promise<boolean> {
  const r = await pool.query("select 1 from platform_admins where coach_id = $1", [coachId]);
  return r.rowCount === 1;
}

export type StaffMember = { id: string; name: string; cell: string; role: "Owner" | "Admin"; grantedBy: string };

// CourtCaptain Owners add and remove CourtCaptain Admins. Owners can't be removed here. Staff have Owner-level access to
// every organization in the background (see acts_as in the database).
export async function setPlatformAdmin(deps: Deps, viewer: SessionUser, coachId: unknown, on: boolean): Promise<Result> {
  if (!isCoachId(coachId)) return { ok: false, message: "Pick a person." };
  return withTx(deps.pool, async (q) => {
    const me = await q.query("select 1 from platform_admins where coach_id = $1 and role = 'Owner'", [viewer.coachId]);
    if (!me.rowCount) return { ok: false as const, message: "Only a CourtCaptain Owner can do that." };
    if (on) {
      const u = await q.query("select 1 from users where coach_id = $1 and active", [coachId]);
      if (!u.rowCount) return { ok: false as const, message: "That person isn't an active user." };
      await q.query(
        "insert into platform_admins (coach_id, granted_by, granted_at, role) values ($1, $2, $3, 'Admin') on conflict do nothing",
        [coachId, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
      );
      return { ok: true as const };
    }
    const r = await q.query<{ role: string }>("select role from platform_admins where coach_id = $1 for update", [coachId]);
    if (!r.rows[0]) return { ok: false as const, message: "That person isn't CourtCaptain staff." };
    if (r.rows[0].role === "Owner") return { ok: false as const, message: "CourtCaptain Owners can't be removed." };
    await q.query("delete from platform_admins where coach_id = $1 and role = 'Admin'", [coachId]);
    return { ok: true as const };
  });
}

export type PlatformOrg = {
  slug: OrgSlug;
  name: string;
  abbr: string; // shown before its team names in leagues ("ER 5B Harris")
  logo: string | null;
  color: string;
  features: { key: Feature; name: string; on: boolean; always: boolean; source: string | null; since: Date | null }[];
  owners: { id: string; name: string; cell: string | null; email: string | null }[]; // contact info for support
  admins: { id: string; name: string }[]; // Admins who aren't Owners (shown; Owners choose them)
  directors: DirectorRow[]; // Directors who aren't Admins, with their areas (shown; Admins choose them)
  options: { id: string; name: string }[]; // active users who aren't its Owners yet
  stats: OrgStats;
};

// The short numbers under each organization's card. players: null where the organization keeps no players (Scenic City).
export type OrgStats = {
  people: number; // with a role there or a place on one of its teams (CourtCaptain staff not counted)
  teams: number;
  players: number | null; // Thunder: registered; others: on their teams' rosters
  coaches: number; // active Head and Assistant Coaches
  coachesThisWeek: number; // …who logged in in the last 7 days
  visitsToday: number; // page views (lib/site-visits.ts), Eastern days; the week starts Monday
  visitsWeek: number;
};

async function orgStats(q: Pick<Queryable, "query">, org: OrgSlug, now: Date): Promise<OrgStats> {
  const thunder = org === "thunder";
  const coaches = thunder
    ? "select coach_id from team_staff where role in ('HeadCoach', 'AsstCoach')"
    : "select c.coach_id from org_team_coaches c join org_teams t on t.id = c.team_id where t.org = $1";
  const r = await q.query<OrgStats>(
    `select
       (select count(*)::int from users u
        where not exists (select 1 from platform_admins p where p.coach_id = u.coach_id)
          and (exists (select 1 from org_roles o where o.coach_id = u.coach_id and o.org = $1)
               or ($1 = 'thunder' and exists (select 1 from team_staff s where s.coach_id = u.coach_id))
               or exists (select 1 from org_team_coaches c join org_teams t on t.id = c.team_id
                          where c.coach_id = u.coach_id and t.org = $1))) as people,
       ${
         thunder
           ? "(select count(*)::int from teams)"
           : org === "scenic-city"
             ? "(select count(*)::int from scenic_teams)"
             : "(select count(*)::int from org_teams where org = $1)"
       } as teams,
       ${
         thunder
           ? "(select count(*)::int from registrations)"
           : org === "scenic-city"
             ? "null::int"
             : "(select count(*)::int from org_team_players p join org_teams t on t.id = p.team_id where t.org = $1)"
       } as players,
       (select count(*)::int from users u where u.active and u.coach_id in (${coaches})) as coaches,
       (select count(*)::int from users u where u.active and u.coach_id in (${coaches})
          and u.last_login_at > $2::timestamptz - interval '7 days') as "coachesThisWeek",
       (select coalesce(sum(views), 0)::int from site_visits
        where org = $1 and hour >= date_trunc('day', $2::timestamptz at time zone $3) at time zone $3) as "visitsToday",
       (select coalesce(sum(views), 0)::int from site_visits
        where org = $1 and hour >= date_trunc('week', $2::timestamptz at time zone $3) at time zone $3) as "visitsWeek"`,
    [org, now, TZ],
  );
  return r.rows[0];
}

// Everything on the CourtCaptain page; null for anyone who isn't an admin.
export async function platformOverview(
  deps: Deps,
  viewer: SessionUser,
): Promise<{
  orgs: PlatformOrg[];
  platformAdmins: StaffMember[]; // CourtCaptain staff: Owners first
  isOwner: boolean; // the viewer is a CourtCaptain Owner (adds and removes CourtCaptain Admins)
  staffOptions: { id: string; name: string }[]; // active users who aren't CourtCaptain staff
} | null> {
  if (!(await isPlatformAdmin(deps.pool, viewer.coachId))) return null;
  const [feats, users, admins] = await Promise.all([
    deps.pool.query<{ org: string; feature: string; source: string; turned_on_at: Date }>(
      "select org, feature, source, turned_on_at from org_features",
    ),
    deps.pool.query<{ id: string; name: string }>(
      `select coach_id as id, first_name || ' ' || last_name as name from users where active
       order by lower(last_name), lower(first_name)`,
    ),
    deps.pool.query<StaffMember>(
      `select u.coach_id as id, u.first_name || ' ' || u.last_name as name, u.cell, a.role, a.granted_by as "grantedBy"
       from platform_admins a join users u using (coach_id)
       order by a.role = 'Admin', lower(u.last_name), lower(u.first_name)`,
    ),
  ]);
  const all = await listOrgs(deps.pool);
  const [people, stats] = await Promise.all([
    Promise.all(all.map((o) => listDirectors(deps.pool, o.slug))),
    Promise.all(all.map((o) => orgStats(deps.pool, o.slug, deps.now()))),
  ]);
  const ownerIds = [
    ...new Set(
      people
        .flat()
        .filter((d) => d.owner)
        .map((d) => d.id),
    ),
  ];
  const emails = new Map(
    (
      await deps.pool.query<{ id: string; email: string | null }>(
        "select coach_id as id, email from users where coach_id = any($1)",
        [ownerIds],
      )
    ).rows.map((r) => [r.id, r.email]),
  );
  const orgs = all.map(({ slug, name, abbr, logo, color }, i): PlatformOrg => {
    const mine = new Map(feats.rows.filter((f) => f.org === slug).map((f) => [f.feature, f]));
    const team = people[i];
    const ownerIds = new Set(team.filter((d) => d.owner).map((d) => d.id));
    return {
      slug,
      name,
      abbr,
      logo,
      color,
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
      owners: team.filter((d) => d.owner).map((d) => ({ id: d.id, name: d.name, cell: d.cell, email: emails.get(d.id) ?? null })),
      admins: team.filter((d) => d.admin && !d.owner).map((d) => ({ id: d.id, name: d.name })),
      directors: team.filter((d) => !d.admin),
      options: users.rows.filter((u) => !ownerIds.has(u.id)),
      stats: stats[i],
    };
  });
  const staffIds = new Set(admins.rows.map((a) => a.id));
  return {
    orgs,
    platformAdmins: admins.rows,
    isOwner: admins.rows.some((a) => a.id === viewer.coachId && a.role === "Owner"),
    staffOptions: users.rows.filter((u) => !staffIds.has(u.id)),
  };
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
  if (!isOrgSlug(org) || !f || !(await orgInfo(deps.pool, org)))
    return { ok: false, message: "Pick an organization and a feature." };
  if ("always" in f && f.always) return { ok: false, message: `${f.name} comes with every organization.` };
  // A registered organization can only get features that work for it today.
  if (on && !(BUILT_IN as readonly string[]).includes(org) && !READY_FOR_ANY_ORG.has(f.key))
    return { ok: false, message: `${f.name} isn't ready for registered organizations yet.` };
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
    if (!(await q.query("select 1 from organizations where slug = $1 for update", [org])).rowCount)
      return { ok: false as const, message: "That organization no longer exists." };
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
    if (n.rows[0].n === 0) return { ok: false as const, message: `${await orgName(q, org)} needs at least one Owner.` };
    await q.query("select set_role($1, $2, 'Owner', false, $3)", [coachId, org, who]);
    return { ok: true as const };
  });
}
