// Parents' logins by the cell on a registration (Members → Players and Families, whose pages check who may see them): whether
// their email is verified, and (Admins, not while viewing as someone) whether this viewer can View as them and reset them.
import type { SessionUser } from "./auth/service";
import { resettable } from "./login-reset";
import { isThunderAdmin } from "./org-admin";
import type { Queryable } from "./sql";

export type GuardianLogin = { id: string; verified: boolean; viewAs: boolean; reset: boolean };

export async function guardianLogins(q: Pick<Queryable, "query">, viewer: SessionUser, cells: (string | null)[]): Promise<Map<string, GuardianLogin>> {
  const list = [...new Set(cells.filter((c): c is string => !!c && /^\d{10}$/.test(c)))];
  if (!list.length) return new Map();
  const r = await q.query<{ cell: string; id: string; verified: boolean }>(
    `select cell, coach_id as id, (email is not null and lower(trim(email)) = lower(trim(coalesce(verified_email, '')))) as verified
       from users where active and cell = any($1)`,
    [list],
  );
  const admin = isThunderAdmin(viewer) && !viewer.actingBy;
  const can = admin ? await resettable(q, viewer.coachId, "thunder", r.rows.map((u) => u.id)) : new Set<string>();
  return new Map(r.rows.map((u) => [u.cell, { id: u.id, verified: u.verified, viewAs: admin && u.id !== viewer.coachId, reset: can.has(u.id) }]));
}
