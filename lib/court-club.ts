// CourtClub (SPEC.md section 14): a club's teams register into CourtCaptain-managed events. A team is active from its
// event registration until `days` after the event ends (the club's setting, default 30); a new team is active for that
// many days to get registered. A stand-alone team is a club of one (organizations.kind = 'Team').
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { isOrgAdmin } from "./org-admin";
import type { Queryable } from "./sql";

export const CLUB_DAYS = { default: 30, min: 1, max: 365 } as const;

export async function clubActiveDays(q: Pick<Queryable, "query">, org: string): Promise<number> {
  const r = await q.query<{ d: number | null }>("select club_active_days as d from organizations where slug = $1", [org]);
  return r.rows[0]?.d ?? CLUB_DAYS.default;
}

// The club's Owners and Admins.
export async function setClubActiveDays(
  deps: { pool: Pool },
  viewer: SessionUser,
  org: string,
  days: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!Number.isInteger(days) || (days as number) < CLUB_DAYS.min || (days as number) > CLUB_DAYS.max)
    return { ok: false, message: `Days must be ${CLUB_DAYS.min}–${CLUB_DAYS.max}.` };
  if (!(await isOrgAdmin(deps.pool, viewer.coachId, org)))
    return { ok: false, message: "Only an Admin of this organization can change its CourtClub settings." };
  // CourtClub comes with every organization.
  const r = await deps.pool.query("update organizations set club_active_days = $2 where slug = $1", [org, days]);
  if (!r.rowCount) return { ok: false, message: "That organization doesn't exist." };
  return { ok: true };
}
