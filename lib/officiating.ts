// CourtSync officiating (SPEC.md section 14, step 4c): an Officials Group (CourtOfficials + CourtSync) asks a league (a
// CourtSync Scheduler: CourtTeams + CourtSync) to officiate its games. The group's Admins and Directors of Officials ask;
// the league's Admins and Directors of Scheduling or Programs approve or decline. Next: the league assigns an approved
// group to each gym of a program.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { orgFeatureKeys, orgFeatures, syncPart } from "./features";
import { orgHasArea } from "./org-admin";
import { isOrgSlug, type OrgSlug } from "./orgs";
import { listOrgs, orgName, orgShort } from "./org-registry";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };
export type OfficiatingStatus = "none" | "pending" | "approved" | "declined";

const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

// An Officials Group with CourtSync on (its part is Officials).
export async function officiatesGames(q: Pick<Queryable, "query">, org: OrgSlug): Promise<boolean> {
  const has = await orgFeatureKeys(q, org);
  return has.has("court-sync") && syncPart(has) === "Officials";
}
// A league that schedules its games (CourtSync Scheduler).
const isLeague = async (q: Pick<Queryable, "query">, org: OrgSlug) => (await orgFeatures(q, org)).has("hosting-partners");
const groupSide = (q: Pick<Queryable, "query">, viewer: SessionUser, org: OrgSlug) => orgHasArea(q, viewer.coachId, org, "officials");
const leagueSide = (q: Pick<Queryable, "query">, viewer: SessionUser, org: OrgSlug) =>
  orgHasArea(q, viewer.coachId, org, "scheduling", "programs");

export type OfficiatingOffer = { org: OrgSlug; name: string; status: OfficiatingStatus; requestedBy: string | null; decidedBy: string | null };

// For the Officials Group: every league, and where things stand with each.
export async function officiatingOffers(deps: Pick<Deps, "pool">, viewer: SessionUser, officialsOrg: OrgSlug): Promise<OfficiatingOffer[] | null> {
  if (!(await officiatesGames(deps.pool, officialsOrg)) || !(await groupSide(deps.pool, viewer, officialsOrg))) return null;
  const r = await deps.pool.query<{ for_org: OrgSlug; status: OfficiatingStatus; requested_by: string; decided_by: string | null }>(
    "select for_org, status, requested_by, decided_by from officiating_partnerships where officials_org = $1",
    [officialsOrg],
  );
  const out: OfficiatingOffer[] = [];
  for (const { slug: org, name } of await listOrgs(deps.pool)) {
    if (org === officialsOrg || !(await isLeague(deps.pool, org))) continue;
    const p = r.rows.find((x) => x.for_org === org);
    out.push({ org, name, status: p?.status ?? "none", requestedBy: p?.requested_by ?? null, decidedBy: p?.decided_by ?? null });
  }
  return out;
}

// Ask a league to officiate its games (again, after a decline).
export async function requestOfficiating(deps: Deps, viewer: SessionUser, officialsOrg: unknown, forOrg: unknown): Promise<Result> {
  if (!isOrgSlug(officialsOrg) || !isOrgSlug(forOrg) || officialsOrg === forOrg) return { ok: false, message: "Pick a league." };
  return withTx(deps.pool, async (q) => {
    if (!(await groupSide(q, viewer, officialsOrg)))
      return { ok: false as const, message: `Only a ${await orgShort(q, officialsOrg)} Admin or Director of Officials can do that.` };
    if (!(await officiatesGames(q, officialsOrg)))
      return { ok: false as const, message: "Turn on CourtSync (gear → Feature Settings) to work leagues' games." };
    if (!(await isLeague(q, forOrg))) return { ok: false as const, message: `${await orgName(q, forOrg)} doesn't schedule games on CourtCaptain.` };
    const r = await q.query(
      `insert into officiating_partnerships (officials_org, for_org, status, requested_by, requested_at) values ($1, $2, 'pending', $3, $4)
       on conflict (officials_org, for_org) do update
         set status = 'pending', requested_by = $3, requested_at = $4, decided_by = null, decided_at = null
         where officiating_partnerships.status = 'declined'`,
      [officialsOrg, forOrg, by(viewer), deps.now()],
    );
    if (!r.rowCount) return { ok: false as const, message: `You've already asked ${await orgName(q, forOrg)}.` };
    return { ok: true as const };
  });
}

export type OfficiatingRequest = {
  id: string;
  officialsOrg: OrgSlug;
  name: string;
  status: Exclude<OfficiatingStatus, "none">;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
};

// For the league: the officials groups that asked, waiting ones first; null for anyone who doesn't decide.
export async function officiatingRequests(deps: Pick<Deps, "pool">, viewer: SessionUser, forOrg: OrgSlug): Promise<OfficiatingRequest[] | null> {
  if (!(await isLeague(deps.pool, forOrg)) || !(await leagueSide(deps.pool, viewer, forOrg))) return null;
  const r = await deps.pool.query<OfficiatingRequest>(
    `select p.id::text, p.officials_org as "officialsOrg", o.name, p.status, p.requested_by as "requestedBy",
            p.requested_at as "requestedAt", p.decided_by as "decidedBy"
       from officiating_partnerships p join organizations o on o.slug = p.officials_org
      where p.for_org = $1
      order by array_position(array['pending', 'approved', 'declined'], p.status), lower(o.name)`,
    [forOrg],
  );
  return r.rows;
}

// Approve or decline a waiting request.
export async function decideOfficiating(deps: Deps, viewer: SessionUser, id: unknown, approve: boolean): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That request no longer exists." };
  return withTx(deps.pool, async (q) => {
    const r = await q.query<{ for_org: OrgSlug; status: string }>(
      "select for_org, status from officiating_partnerships where id = $1 for update",
      [id],
    );
    const p = r.rows[0];
    if (!p) return { ok: false as const, message: "That request no longer exists." };
    if (!(await leagueSide(q, viewer, p.for_org)))
      return { ok: false as const, message: `Only a ${await orgShort(q, p.for_org)} Admin or Director of Scheduling or Programs can do that.` };
    if (p.status !== "pending") return { ok: false as const, message: "That request was already answered." };
    await q.query("update officiating_partnerships set status = $2, decided_by = $3, decided_at = $4 where id = $1", [
      id,
      approve ? "approved" : "declined",
      by(viewer),
      deps.now(),
    ]);
    return { ok: true as const };
  });
}

// ---- Which approved officials group schedules officials at each hosting gym ----

const GYM_KEY = /^[op]\d{1,18}$/;
const assigns = (q: Pick<Queryable, "query">, viewer: SessionUser, org: OrgSlug) =>
  orgHasArea(q, viewer.coachId, org, "scheduling", "programs", "facilities");

// May this person pick a gym's officials group (Admins and Directors of Scheduling, Programs or Facilities)?
export async function assignsGymOfficials(q: Pick<Queryable, "query">, viewer: SessionUser, org: OrgSlug): Promise<boolean> {
  return (await isLeague(q, org)) && (await assigns(q, viewer, org));
}

// The officials groups approved to officiate this league's games, by name.
export async function approvedGroups(q: Pick<Queryable, "query">, org: OrgSlug): Promise<{ org: OrgSlug; name: string }[]> {
  const r = await q.query<{ org: OrgSlug; name: string }>(
    `select p.officials_org as org, o.name from officiating_partnerships p join organizations o on o.slug = p.officials_org
      where p.for_org = $1 and p.status = 'approved' order by lower(o.name)`,
    [org],
  );
  return r.rows;
}

// Each gym's officials group in this league: gym key → the group and who set it.
export async function gymOfficials(q: Pick<Queryable, "query">, org: OrgSlug): Promise<Map<string, { org: OrgSlug; name: string; setBy: string }>> {
  const r = await q.query<{ gym_key: string; org: OrgSlug; name: string; set_by: string }>(
    `select g.gym_key, g.officials_org as org, o.name, g.set_by from gym_officials g join organizations o on o.slug = g.officials_org
      where g.org = $1`,
    [org],
  );
  return new Map(r.rows.map((x) => [x.gym_key, { org: x.org, name: x.name, setBy: x.set_by }]));
}

// Set (an approved group) or clear (null) the officials group for one of the league's hosting gyms.
export async function setGymOfficials(deps: Deps, viewer: SessionUser, org: unknown, gymKey: unknown, officialsOrg: unknown): Promise<Result> {
  if (!isOrgSlug(org) || !(await assignsGymOfficials(deps.pool, viewer, org)))
    return { ok: false, message: "Only an Admin or Director of Scheduling, Programs or Facilities can do that." };
  if (typeof gymKey !== "string" || !GYM_KEY.test(gymKey)) return { ok: false, message: "That gym no longer exists." };
  const id = gymKey.slice(1);
  const gym = gymKey.startsWith("o")
    ? await deps.pool.query(
        `select 1 from gyms g join org_partnerships p on p.host_org = g.org and p.for_org = $2 and p.status = 'approved'
          where g.id = $1 and g.active`,
        [id, org],
      )
    : await deps.pool.query("select 1 from partner_gyms where id = $1", [id]);
  if (!gym.rowCount) return { ok: false, message: "That gym no longer exists." };
  if (officialsOrg === null) {
    await deps.pool.query("delete from gym_officials where org = $1 and gym_key = $2", [org, gymKey]);
    return { ok: true };
  }
  if (!isOrgSlug(officialsOrg) || !(await approvedGroups(deps.pool, org)).some((g) => g.org === officialsOrg))
    return { ok: false, message: "Pick an officials group you've approved." };
  await deps.pool.query(
    `insert into gym_officials (org, gym_key, officials_org, set_by, set_at) values ($1, $2, $3, $4, $5)
     on conflict (org, gym_key) do update set officials_org = $3, set_by = $4, set_at = $5`,
    [org, gymKey, officialsOrg, by(viewer), deps.now()],
  );
  return { ok: true };
}

// How many of the league's hosting gyms have no officials group yet: the active gyms of approved hosting organizations,
// and the gyms it typed in for partners that host games.
export async function gymsWithoutOfficials(q: Pick<Queryable, "query">, org: OrgSlug): Promise<number> {
  const r = await q.query<{ n: number }>(
    `select count(*)::int as n from (
       select 'o' || g.id as key from gyms g
         join org_partnerships p on p.host_org = g.org and p.for_org = $1 and p.status = 'approved'
        where g.active
       union all
       select 'p' || g.id from partner_gyms g join partners pa on pa.id = g.partner_id
        where pa.hosts_games and pa.org_slug is null
     ) x where not exists (select 1 from gym_officials o where o.org = $1 and o.gym_key = x.key)`,
    [org],
  );
  return r.rows[0].n;
}
