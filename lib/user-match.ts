// Find the user with this cell, or create their login (starter PIN 1234, no email: they give and verify one at first
// login). Used when a coach is named by cell (Thunder team staff, Scenic City teams). Runs inside the caller's transaction.
import type { PoolClient } from "pg";
import { coachIdFromCell } from "./phone";

export type MatchedUser = { coachId: string; lastName: string; who: string; newLogin: boolean };

// Refuses (returns { error }) a cell whose last 7 digits belong to someone else, or a deactivated account.
export async function matchOrCreateUser(
  q: PoolClient,
  p: { first: string; last: string; cell: string; email: string | null },
  now: Date,
): Promise<MatchedUser | { error: string }> {
  const coachId = coachIdFromCell(p.cell);
  await q.query("select pg_advisory_xact_lock(hashtext('user:' || $1))", [coachId]);
  const existing = await q.query<{ cell: string; first_name: string; last_name: string; active: boolean }>(
    "select cell, first_name, last_name, active from users where coach_id = $1",
    [coachId],
  );
  const e = existing.rows[0];
  if (e && e.cell !== p.cell)
    return {
      error: `${p.first} ${p.last}'s cell ends in the same 7 digits as ${e.first_name} ${e.last_name}'s. Please contact support.`,
    };
  if (e && !e.active) return { error: `${e.first_name} ${e.last_name} has a deactivated account.` };
  if (e) return { coachId, lastName: e.last_name, who: `${e.first_name} ${e.last_name}`, newLogin: false };
  await q.query(
    `insert into users (coach_id, first_name, last_name, cell, email, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $6)`,
    [coachId, p.first, p.last, p.cell, p.email, now],
  );
  return { coachId, lastName: p.last, who: `${p.first} ${p.last}`, newLogin: true };
}
