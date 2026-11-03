// Reset login (SPEC.md section 14), the same in every organization: PIN back to starter 1234, email cleared, logged out
// everywhere, PIN lockout and pending codes cleared. At their next login they give an email, confirm it with a code, and
// choose a new PIN.
// Who may reset whom, in an organization (never yourself):
// - its Owners (and CourtCaptain staff, from the CourtCaptain page): anyone in it, other Owners and Admins too;
// - its Admins: anyone in it except its Owners and Admins.
// Someone who is also an Owner or Admin of another organization is reset only by an Owner there (or CourtCaptain staff),
// and CourtCaptain staff only by CourtCaptain staff, so one organization can't lock out another's leaders.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { isOrgSlug } from "./orgs";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };

const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

// Of these people, the ones the viewer may reset in this organization.
export async function resettable(
  q: Pick<Queryable, "query">,
  viewerId: string,
  org: string,
  coachIds: string[],
): Promise<Set<string>> {
  if (!coachIds.length) return new Set();
  const r = await q.query<{ id: string }>(
    `select u.coach_id as id from users u
     where u.coach_id = any($3::text[]) and u.coach_id <> $1
       -- in this organization: a role there (a request too) or a place on one of its teams
       and (exists (select 1 from org_roles o where o.coach_id = u.coach_id and o.org = $2)
            or ($2 = 'thunder' and exists (select 1 from team_staff s where s.coach_id = u.coach_id))
            or exists (select 1 from org_team_coaches c join org_teams t on t.id = c.team_id where c.coach_id = u.coach_id and t.org = $2))
       and (acts_as($1, $2, 'Owner')
            or (acts_as($1, $2, 'Admin') and not has_role(u.coach_id, $2, 'Owner') and not has_role(u.coach_id, $2, 'Admin')))
       and not exists (select 1 from org_roles o where o.coach_id = u.coach_id and o.org <> $2 and o.role in ('Owner', 'Admin')
                         and not acts_as($1, o.org, 'Owner'))
       and (not exists (select 1 from platform_admins p where p.coach_id = u.coach_id)
            or exists (select 1 from platform_admins p where p.coach_id = $1))`,
    [viewerId, org, coachIds],
  );
  return new Set(r.rows.map((x) => x.id));
}

export async function resetOrgLogin(deps: Deps, viewer: SessionUser, org: unknown, coachId: unknown): Promise<Result> {
  if (!isOrgSlug(org) || typeof coachId !== "string" || !/^\d{7}$/.test(coachId))
    return { ok: false, message: "That user no longer exists." };
  if (coachId === viewer.coachId) return { ok: false, message: "You can't reset your own login." };
  return withTx(deps.pool, async (q) => {
    const u = await q.query<{ cell: string }>("select cell from users where coach_id = $1 for update", [coachId]);
    if (!u.rows[0]) return { ok: false as const, message: "That user no longer exists." };
    if (!(await resettable(q, viewer.coachId, org, [coachId])).has(coachId))
      return {
        ok: false as const,
        message: "Only an Owner can reset an Owner's or Admin's login; Admins reset everyone else in their organization.",
      };
    await q.query(
      "update users set pin_hash = null, email = null, verified_email = null, updated_at = $2, updated_by = $3 where coach_id = $1",
      [coachId, deps.now(), by(viewer)],
    );
    await q.query("delete from sessions where coach_id = $1", [coachId]);
    await q.query("delete from pin_lockouts where cell = $1", [u.rows[0].cell]);
    await q.query("delete from email_codes where cell = $1", [u.rows[0].cell]);
    return { ok: true as const };
  });
}
