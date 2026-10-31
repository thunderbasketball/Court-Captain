// Organizations partnering with each other (SPEC.md section 14). An organization with "Hosting Sites Available" (e.g.
// Thunder) asks one with "Hosting Sites Wanted" (e.g. Scenic City) to host its games. When approved, it becomes that
// organization's hosting partner: a partners row linked to it (partners.org_slug). Each side's Admins and Directors of
// Facilities handle it.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { orgHasArea } from "./org-admin";
import { ORGS, ORG_SLUGS, isOrgSlug, type OrgSlug } from "./orgs";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };
export type PartnershipStatus = "none" | "pending" | "approved" | "declined";

const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const facilities = (q: Queryable, viewer: SessionUser, org: OrgSlug) => orgHasArea(q, viewer.coachId, org, "facilities");

export type HostingOffer = {
  org: OrgSlug;
  name: string;
  status: PartnershipStatus;
  requestedBy: string | null;
  decidedBy: string | null;
};

// For the hosting organization (e.g. Thunder): every organization that wants hosting sites, and where things stand.
export async function hostingOffers(deps: Deps, viewer: SessionUser, hostOrg: OrgSlug): Promise<HostingOffer[] | null> {
  if (!(await hasFeature(deps.pool, hostOrg, "hosting-available")) || !(await facilities(deps.pool, viewer, hostOrg)))
    return null;
  const r = await deps.pool.query<{
    for_org: OrgSlug;
    status: PartnershipStatus;
    requested_by: string;
    decided_by: string | null;
  }>("select for_org, status, requested_by, decided_by from org_partnerships where host_org = $1", [hostOrg]);
  const out: HostingOffer[] = [];
  for (const org of ORG_SLUGS) {
    if (org === hostOrg || !(await hasFeature(deps.pool, org, "hosting-partners"))) continue;
    const p = r.rows.find((x) => x.for_org === org);
    out.push({
      org,
      name: ORGS[org].name,
      status: p?.status ?? "none",
      requestedBy: p?.requested_by ?? null,
      decidedBy: p?.decided_by ?? null,
    });
  }
  return out;
}

// Ask to host another organization's games (again, after a decline).
export async function requestHosting(deps: Deps, viewer: SessionUser, hostOrg: unknown, forOrg: unknown): Promise<Result> {
  if (!isOrgSlug(hostOrg) || !isOrgSlug(forOrg) || hostOrg === forOrg) return { ok: false, message: "Pick an organization." };
  return withTx(deps.pool, async (q) => {
    if (!(await facilities(q, viewer, hostOrg)))
      return { ok: false as const, message: `Only a ${ORGS[hostOrg].short} Admin or Director of Facilities can do that.` };
    if (!(await hasFeature(q, hostOrg, "hosting-available")))
      return { ok: false as const, message: `${ORGS[hostOrg].name} doesn't have Hosting Sites Available.` };
    if (!(await hasFeature(q, forOrg, "hosting-partners")))
      return { ok: false as const, message: `${ORGS[forOrg].name} isn't looking for hosting sites.` };
    const r = await q.query(
      `insert into org_partnerships (host_org, for_org, status, requested_by, requested_at) values ($1, $2, 'pending', $3, $4)
       on conflict (host_org, for_org) do update
         set status = 'pending', requested_by = $3, requested_at = $4, decided_by = null, decided_at = null
         where org_partnerships.status = 'declined'`,
      [hostOrg, forOrg, by(viewer), deps.now()],
    );
    if (!r.rowCount) return { ok: false as const, message: `You've already asked ${ORGS[forOrg].name}.` };
    return { ok: true as const };
  });
}

export type HostingRequest = {
  id: string;
  hostOrg: OrgSlug;
  name: string;
  status: Exclude<PartnershipStatus, "none">;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
};

// For the organization that wants hosting sites (e.g. Scenic City): who has asked to host, waiting ones first.
export async function hostingRequests(deps: Deps, viewer: SessionUser, forOrg: OrgSlug): Promise<HostingRequest[] | null> {
  if (!(await facilities(deps.pool, viewer, forOrg))) return null;
  const r = await deps.pool.query<Omit<HostingRequest, "name">>(
    `select id::text, host_org as "hostOrg", status, requested_by as "requestedBy", requested_at as "requestedAt", decided_by as "decidedBy"
     from org_partnerships where for_org = $1
     order by array_position(array['pending', 'approved', 'declined'], status), requested_at`,
    [forOrg],
  );
  return r.rows.map((x) => ({ ...x, name: ORGS[x.hostOrg]?.name ?? x.hostOrg }));
}

// Approve (the host becomes a hosting partner, linked to its organization) or decline a waiting request.
export async function decideHosting(deps: Deps, viewer: SessionUser, id: unknown, approve: boolean): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That request no longer exists." };
  return withTx(deps.pool, async (q) => {
    const r = await q.query<{ host_org: OrgSlug; for_org: OrgSlug; status: string }>(
      "select host_org, for_org, status from org_partnerships where id = $1 for update",
      [id],
    );
    const p = r.rows[0];
    if (!p) return { ok: false as const, message: "That request no longer exists." };
    if (!(await facilities(q, viewer, p.for_org)))
      return { ok: false as const, message: `Only a ${ORGS[p.for_org].short} Admin or Director of Facilities can do that.` };
    if (p.status !== "pending") return { ok: false as const, message: "That request was already answered." };
    let partnerId: string | null = null;
    if (approve) {
      const name = ORGS[p.host_org].name;
      // The organization's partner record: already linked, or one with its name (e.g. Thunder Basketball), or a new one.
      const found = await q.query<{ id: string }>(
        `select id::text from partners where org_slug = $1
         union all select id::text from partners where org_slug is null and lower(name) = lower($2)
         limit 1`,
        [p.host_org, name],
      );
      if (found.rows[0]) {
        partnerId = found.rows[0].id;
        await q.query("update partners set org_slug = $2, hosts_games = true, approved = true where id = $1", [
          partnerId,
          p.host_org,
        ]);
      } else {
        const ins = await q.query<{ id: string }>(
          `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug)
           values ($1, 'Organization', true, false, true, $2, $3) returning id::text`,
          [name, by(viewer), p.host_org],
        );
        partnerId = ins.rows[0].id;
      }
    }
    await q.query("update org_partnerships set status = $2, decided_by = $3, decided_at = $4, partner_id = $5 where id = $1", [
      id,
      approve ? "approved" : "declined",
      by(viewer),
      deps.now(),
      partnerId,
    ]);
    return { ok: true as const };
  });
}
