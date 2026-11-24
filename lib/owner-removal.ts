// Removing an Owner (SPEC.md section 14): an Owner asks to remove another; that Owner is emailed and stays one until they
// approve (or decline) it themselves, on their Home. Whoever asked is emailed the answer; any Owner can cancel it. An
// organization always keeps an Owner. (Stepping down yourself needs no one's approval: lib/org-admin setOwner.) CourtCaptain
// staff can still remove one on the platform page, for an Owner who can't be reached.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { isOrgOwner } from "./org-admin";
import { orgName } from "./org-registry";
import { isOrgSlug } from "./orgs";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date; sendEmail: (to: string, subject: string, text: string) => Promise<void> };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const EMAIL = "coalesce(u.verified_email, u.email)";

export type OwnerRemoval = { id: string; org: string; orgName: string; coachId: string; name: string; requestedBy: string; at: Date };

// Waiting removals: an organization's (its Owners' list) or a person's own (their Home).
async function waiting(q: Pick<Queryable, "query">, where: string, value: string): Promise<OwnerRemoval[]> {
  const r = await q.query<OwnerRemoval>(
    `select x.id::text, x.org, o.name as "orgName", x.coach_id as "coachId", u.first_name || ' ' || u.last_name as name,
            x.requested_name as "requestedBy", x.requested_at as at
       from owner_removals x join organizations o on o.slug = x.org join users u on u.coach_id = x.coach_id
      where x.decision is null and has_role(x.coach_id, x.org, 'Owner') and ${where} order by x.requested_at`,
    [value],
  );
  return r.rows;
}
export const orgOwnerRemovals = (q: Pick<Queryable, "query">, org: string) => waiting(q, "x.org = $1", org);
export const myOwnerRemovals = (q: Pick<Queryable, "query">, coachId: string) => waiting(q, "x.coach_id = $1", coachId);

const otherOwners = async (q: Pick<Queryable, "query">, org: string, coachId: string) =>
  (
    await q.query<{ n: number }>(
      `select count(*)::int as n from org_roles r where r.org = $1 and r.role = 'Owner' and r.coach_id <> $2
         and not exists (select 1 from platform_admins p where p.coach_id = r.coach_id)`,
      [org, coachId],
    )
  ).rows[0].n;

// Ask: the Owner is emailed (with the link to answer); nothing changes until they approve.
export async function requestOwnerRemoval(deps: Deps, viewer: SessionUser, org: unknown, coachId: unknown, base: string): Promise<Result<{ emailed: boolean }>> {
  if (!isOrgSlug(org) || typeof coachId !== "string" || !/^\d{7}$/.test(coachId)) return { ok: false, message: "Pick a person." };
  if (coachId === viewer.coachId) return { ok: false, message: "You can step down yourself; no approval is needed." };
  const r = await withTx(deps.pool, async (q) => {
    if (!(await q.query("select 1 from organizations where slug = $1 for update", [org])).rowCount)
      return { ok: false as const, message: "That organization no longer exists." };
    const name = await orgName(q, org);
    if (!(await isOrgOwner(q, viewer.coachId, org))) return { ok: false as const, message: `Only an Owner of ${name} can do that.` };
    const u = (
      await q.query<{ first: string; name: string; email: string | null }>(
        `select u.first_name as first, u.first_name || ' ' || u.last_name as name, ${EMAIL} as email
           from users u join org_roles r on r.coach_id = u.coach_id and r.org = $2 and r.role = 'Owner' where u.coach_id = $1`,
        [coachId, org],
      )
    ).rows[0];
    if (!u) return { ok: false as const, message: "They aren't an Owner of this organization." };
    if ((await otherOwners(q, org, coachId)) === 0) return { ok: false as const, message: `${name} needs at least one Owner.` };
    const ins = await q.query(
      `insert into owner_removals (org, coach_id, requested_by, requested_name, requested_at) values ($1, $2, $3, $4, $5)
       on conflict (org, coach_id) where decision is null do nothing`,
      [org, coachId, viewer.coachId, by(viewer), deps.now()],
    );
    if (!ins.rowCount) return { ok: false as const, message: `${u.name} was already asked. It's waiting for their approval.` };
    return { ok: true as const, u, name };
  });
  if (!r.ok) return r;
  let emailed = false;
  if (r.u.email)
    try {
      await deps.sendEmail(
        r.u.email,
        `${r.name}: your approval is needed to remove you as an Owner`,
        [
          `Hi ${r.u.first},`,
          "",
          `${by(viewer)} asked to remove you as an Owner of ${r.name} on CourtCaptain.`,
          "Nothing changes unless you approve it. If you do, you stay an Admin.",
          "",
          `To approve or decline, log in and open Owner removal on your Home: ${base.replace(/\/+$/, "")}/switch?org=${org}`,
          "",
          "This is an automatic email. Replies aren't read.",
        ].join("\n"),
      );
      emailed = true;
    } catch (e) {
      console.error("Owner removal email failed:", e); // it still waits on their Home
    }
  return { ok: true, emailed };
}

// The Owner's own answer. Approved: they stop being an Owner (they stay an Admin). Whoever asked is emailed.
export async function decideOwnerRemoval(deps: Deps, viewer: SessionUser, id: unknown, approve: unknown): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That request wasn't found." };
  const yes = approve === true;
  const r = await withTx(deps.pool, async (q) => {
    const found = (await q.query<{ org: string }>("select org from owner_removals where id = $1 and coach_id = $2", [id, viewer.coachId])).rows[0];
    if (!found) return { ok: false as const, message: "That request wasn't found." };
    await q.query("select 1 from organizations where slug = $1 for update", [found.org]); // one Owner change at a time
    const x = (
      await q.query<{ org: string; requested_by: string }>(
        "select org, requested_by from owner_removals where id = $1 and coach_id = $2 and decision is null for update",
        [id, viewer.coachId],
      )
    ).rows[0];
    if (!x) return { ok: false as const, message: "That was already answered." };
    const name = await orgName(q, x.org);
    if (yes && (await otherOwners(q, x.org, viewer.coachId)) === 0) return { ok: false as const, message: `${name} needs at least one Owner.` };
    if (yes) await q.query("select set_role($1, $2, 'Owner', false, $3)", [viewer.coachId, x.org, by(viewer)]);
    await q.query("update owner_removals set decision = $2, decided_by = $3, decided_at = $4 where id = $1", [
      id,
      yes ? "approved" : "declined",
      by(viewer),
      deps.now(),
    ]);
    const to = (await q.query<{ email: string | null }>(`select ${EMAIL} as email from users u where u.coach_id = $1`, [x.requested_by])).rows[0]?.email;
    return { ok: true as const, name, to: to ?? null };
  });
  if (!r.ok) return r;
  if (r.to)
    await deps
      .sendEmail(
        r.to,
        `${r.name}: ${by(viewer)} ${yes ? "approved" : "declined"} being removed as an Owner`,
        `${by(viewer)} ${yes ? `is no longer an Owner of ${r.name}. They stay an Admin.` : `declined: they're still an Owner of ${r.name}.`}\n\nThis is an automatic email. Replies aren't read.`,
      )
      .catch((e) => console.error("Owner removal answer email failed:", e));
  return { ok: true };
}

// Any Owner of the organization takes the request back.
export async function cancelOwnerRemoval(deps: Pick<Deps, "pool" | "now">, viewer: SessionUser, id: unknown): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That request wasn't found." };
  return withTx(deps.pool, async (q) => {
    const x = (await q.query<{ org: string }>("select org from owner_removals where id = $1 and decision is null for update", [id])).rows[0];
    if (!x) return { ok: false as const, message: "That was already answered." };
    if (!(await isOrgOwner(q, viewer.coachId, x.org))) return { ok: false as const, message: "Only an Owner can do that." };
    await q.query("update owner_removals set decision = 'cancelled', decided_by = $2, decided_at = $3 where id = $1", [id, by(viewer), deps.now()]);
    return { ok: true as const };
  });
}
