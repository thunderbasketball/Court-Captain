// Scenic City: join requests (Partner or Solo), partners, and the Scenic City Users page (SPEC.md section 13).
// Every function checks the viewer's Scenic City role on the server.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { SCENIC_ROLES, type ScenicRole } from "./orgs";
import { withTx, type Queryable } from "./sql";
import { isOrgAdmin, orgHasArea } from "./org-admin";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
class ScenicError extends Error {}

const ORG = "scenic-city";
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const directorOnly = { ok: false as const, message: "Only a Scenic City Admin can do that." };
const isCoachId = (v: unknown): v is string => typeof v === "string" && /^\d{7}$/.test(v);

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof ScenicError) return { ok: false, message: e.message };
    throw e;
  }
}

// Scenic City Director tools for game days, partners, gyms and courts: a Director of Facilities, or an Admin.
export async function isScenicFacilities(q: Queryable, coachId: string): Promise<boolean> {
  return orgHasArea(q, coachId, ORG, "facilities");
}

// ---- Partners ----

export type PartnerKind = "School" | "Organization";
export type PartnerOption = { id: string; name: string; kind: PartnerKind };

// A partner's name: letters, digits, spaces and . ' & - , ( ). Starts with a letter or digit (so never = + - @).
export function cleanPartnerName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  return /^[A-Za-z0-9][A-Za-z0-9 .'&\-,()]{1,79}$/.test(s) ? s : null;
}

// Approved partners, by name, for the join form.
export async function partnerOptions(deps: Deps): Promise<PartnerOption[]> {
  const r = await deps.pool.query<PartnerOption>(
    "select id::text, name, kind from partners where approved order by lower(name)",
  );
  return r.rows;
}

// ---- Joining ----

export type JoinStatus = "member" | "pending" | "none";

export async function joinStatus(deps: Deps, viewer: SessionUser): Promise<JoinStatus> {
  const r = await deps.pool.query<{ role: string }>("select role from org_roles where coach_id = $1 and org = $2", [viewer.coachId, ORG]);
  if (r.rows.some((x) => x.role !== "Request")) return "member";
  return r.rows.length ? "pending" : "none";
}

export type JoinInput = {
  wants: unknown; // "Partner" | "Solo"
  partnerId?: unknown; // an approved partner, or
  newPartner?: { name: unknown; kind: unknown; hostsGames: unknown; registersTeams: unknown };
};

// Logged in, no Scenic City role yet: ask to join as a Partner (of a partner, maybe a new one) or Solo.
export async function requestJoin(deps: Deps, viewer: SessionUser, input: JoinInput): Promise<Result> {
  const wants = input.wants === "Partner" || input.wants === "Solo" ? input.wants : null;
  if (!wants) return { ok: false, message: "Choose Partner or Solo." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      await q.query("select pg_advisory_xact_lock(hashtext('user:' || $1))", [viewer.coachId]);
      const status = await q.query<{ role: string }>("select role from org_roles where coach_id = $1 and org = $2", [viewer.coachId, ORG]);
      if (status.rows.some((x) => x.role !== "Request")) throw new ScenicError("You're already part of Scenic City.");
      const partnerId = wants === "Partner" ? await choosePartner(q, viewer, input) : null;
      await q.query(
        `insert into access_requests (coach_id, org, wants, partner_id, created_at) values ($1, $2, $3, $4, $5)
         on conflict (coach_id, org) do update set wants = excluded.wants, partner_id = excluded.partner_id, created_at = excluded.created_at`,
        [viewer.coachId, ORG, wants, partnerId, deps.now()],
      );
      await q.query("select set_role($1, $2, 'Request', true, $3)", [viewer.coachId, ORG, by(viewer)]);
      return {};
    }),
  );
}

// An approved partner by id, or a new one (waits for approval). A new name that matches an existing partner uses that one.
async function choosePartner(q: Queryable, viewer: SessionUser, input: JoinInput): Promise<string> {
  if (input.newPartner) {
    const p = input.newPartner;
    const name = cleanPartnerName(p.name);
    if (!name) throw new ScenicError("Enter the school or organization's name (letters, numbers, spaces).");
    if (p.kind !== "School" && p.kind !== "Organization") throw new ScenicError("Choose School or Organization.");
    const hosts = p.hostsGames === true;
    const registers = p.registersTeams === true;
    if (!hosts && !registers) throw new ScenicError("Choose Hosting games, Registering teams, or both.");
    await q.query("select pg_advisory_xact_lock(hashtext('partner:' || lower($1)))", [name]);
    const found = await q.query<{ id: string }>("select id::text from partners where lower(name) = lower($1)", [name]);
    if (found.rows[0]) return found.rows[0].id;
    const r = await q.query<{ id: string }>(
      `insert into partners (name, kind, hosts_games, registers_teams, created_by) values ($1, $2, $3, $4, $5) returning id::text`,
      [name, p.kind, hosts, registers, by(viewer)],
    );
    return r.rows[0].id;
  }
  const id = typeof input.partnerId === "string" && /^\d{1,18}$/.test(input.partnerId) ? input.partnerId : null;
  const ok = id && (await q.query("select 1 from partners where id = $1 and approved", [id])).rows[0];
  if (!ok) throw new ScenicError("Pick your school or organization, or add a new one.");
  return id;
}

// ---- Scenic City Users page (Directors) ----

export type ScenicRequest = {
  coachId: string;
  firstName: string;
  lastName: string;
  cell: string;
  email: string | null;
  wants: "Partner" | "Solo";
  partner: { id: string; name: string; kind: PartnerKind; hostsGames: boolean; registersTeams: boolean; approved: boolean } | null;
  at: Date;
};
export type ScenicMember = {
  coachId: string;
  firstName: string;
  lastName: string;
  cell: string;
  email: string | null;
  active: boolean;
  roles: ScenicRole[];
  partners: string[]; // names of the partners they're a contact for
  grantedBy: string | null; // who granted their most recent role
};

// Requests (oldest first) and everyone holding a Scenic City role (by last name).
export async function listScenicPeople(deps: Deps, viewer: SessionUser): Promise<{ requests: ScenicRequest[]; members: ScenicMember[] } | null> {
  if (!(await isOrgAdmin(deps.pool, viewer.coachId, ORG))) return null;
  const [requests, members] = await Promise.all([
    deps.pool.query<ScenicRequest>(
      `select u.coach_id as "coachId", u.first_name as "firstName", u.last_name as "lastName", u.cell, u.email,
              a.wants, a.created_at as at,
              case when p.id is null then null else json_build_object('id', p.id::text, 'name', p.name, 'kind', p.kind,
                'hostsGames', p.hosts_games, 'registersTeams', p.registers_teams, 'approved', p.approved) end as partner
       from access_requests a join users u on u.coach_id = a.coach_id left join partners p on p.id = a.partner_id
       where a.org = $1 and u.active and has_role(u.coach_id, $1, 'Request')
       order by a.created_at`,
      [ORG],
    ),
    deps.pool.query<ScenicMember>(
      `select u.coach_id as "coachId", u.first_name as "firstName", u.last_name as "lastName", u.cell, u.email, u.active,
              array(select role from org_roles o where o.coach_id = u.coach_id and o.org = $1 and o.role = any($2::text[])
                    order by array_position($2::text[], o.role)) as roles,
              array(select p.name from partner_contacts c join partners p on p.id = c.partner_id
                    where c.coach_id = u.coach_id order by lower(p.name)) as partners,
              (select granted_by from org_roles o where o.coach_id = u.coach_id and o.org = $1 and o.role <> 'Request'
               order by granted_at desc limit 1) as "grantedBy"
       from users u
       where exists (select 1 from org_roles o where o.coach_id = u.coach_id and o.org = $1 and o.role = any($2::text[]))
       order by lower(u.last_name), lower(u.first_name)`,
      [ORG, SCENIC_ROLES],
    ),
  ]);
  return { requests: requests.rows, members: members.rows };
}

// Approve a request as the role it asked for (or another). Approving a Partner approves a new partner and makes them its contact.
export async function approveRequest(deps: Deps, viewer: SessionUser, coachId: unknown, as: unknown): Promise<Result> {
  if (!isCoachId(coachId)) return { ok: false, message: "That request no longer exists." };
  if (!SCENIC_ROLES.includes(as as ScenicRole)) return { ok: false, message: "Pick a role." };
  if (as === "Director") return { ok: false, message: "Approve them as another role; Admins add Directors in the Directors section." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isOrgAdmin(q, viewer.coachId, ORG))) throw new ScenicError(directorOnly.message);
      const r = await q.query<{ partner_id: string | null }>(
        "select partner_id::text from access_requests where coach_id = $1 and org = $2 for update",
        [coachId, ORG],
      );
      const pending = (await q.query("select 1 from org_roles where coach_id = $1 and org = $2 and role = 'Request'", [coachId, ORG])).rows[0];
      if (!r.rows[0] && !pending) throw new ScenicError("That request no longer exists.");
      const partnerId = r.rows[0]?.partner_id ?? null;
      if (as === "Partner" && partnerId) {
        await q.query("update partners set approved = true where id = $1", [partnerId]);
        await q.query("insert into partner_contacts (partner_id, coach_id, added_by) values ($1, $2, $3) on conflict do nothing", [
          partnerId,
          coachId,
          by(viewer),
        ]);
      }
      await q.query("select set_role($1, $2, $3, true, $4), set_role($1, $2, 'Request', false, $4)", [coachId, ORG, as, by(viewer)]);
      await q.query("delete from access_requests where coach_id = $1 and org = $2", [coachId, ORG]);
      await removeOrphanPartner(q, partnerId);
      return {};
    }),
  );
}

// Deny: the request goes away with no role. A new partner only that request named goes too.
export async function denyRequest(deps: Deps, viewer: SessionUser, coachId: unknown): Promise<Result> {
  if (!isCoachId(coachId)) return { ok: false, message: "That request no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isOrgAdmin(q, viewer.coachId, ORG))) throw new ScenicError(directorOnly.message);
      const r = await q.query<{ partner_id: string | null }>(
        "delete from access_requests where coach_id = $1 and org = $2 returning partner_id::text",
        [coachId, ORG],
      );
      await q.query("select set_role($1, $2, 'Request', false, $3)", [coachId, ORG, by(viewer)]);
      await removeOrphanPartner(q, r.rows[0]?.partner_id ?? null);
      return {};
    }),
  );
}

// A partner that was never approved and nobody is asking for any more.
async function removeOrphanPartner(q: Queryable, partnerId: string | null) {
  if (!partnerId) return;
  await q.query(
    `delete from partners p where p.id = $1 and not p.approved
       and not exists (select 1 from access_requests a where a.partner_id = p.id)
       and not exists (select 1 from partner_contacts c where c.partner_id = p.id)`,
    [partnerId],
  );
}

// Set someone's Scenic City roles. Removing Partner also takes them off their partners' contacts.
export async function setScenicRoles(deps: Deps, viewer: SessionUser, coachId: unknown, roles: unknown): Promise<Result> {
  if (!isCoachId(coachId)) return { ok: false, message: "That user no longer exists." };
  const want = new Set(Array.isArray(roles) ? roles.filter((r): r is ScenicRole => SCENIC_ROLES.includes(r)) : []);
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isOrgAdmin(q, viewer.coachId, ORG))) throw new ScenicError(directorOnly.message);
      if (!(await q.query("select 1 from users where coach_id = $1 for update", [coachId])).rows[0])
        throw new ScenicError("That user no longer exists.");
      // Director is left as it is: Admins choose Directors and their areas (lib/org-admin.ts).
      for (const role of SCENIC_ROLES)
        if (role !== "Director") await q.query("select set_role($1, $2, $3, $4, $5)", [coachId, ORG, role, want.has(role), by(viewer)]);
      if (want.size) {
        await q.query("select set_role($1, $2, 'Request', false, $3)", [coachId, ORG, by(viewer)]);
        await q.query("delete from access_requests where coach_id = $1 and org = $2", [coachId, ORG]);
      }
      if (!want.has("Partner")) await q.query("delete from partner_contacts where coach_id = $1", [coachId]);
      return {};
    }),
  );
}
