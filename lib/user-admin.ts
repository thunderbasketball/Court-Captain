// Director tools for users: add, edit (name, email, Active, Coach), approve/deny requests, reset login, delete.
// Directors (and Admins) aren't set here: Admins choose Directors and their areas (lib/org-admin.ts).
// Thunder roles live in org_roles (SPEC.md section 13).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanEmail, cleanName } from "./auth/validate";
import { coachIdFromCell, normalizeCell } from "./phone";
import { withTx, type Queryable } from "./sql";
import { isThunderAdmin } from "./org-admin";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
class UserError extends Error {}

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, message: e.message };
    throw e;
  }
}

const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const directorOnly = { ok: false as const, message: "Only an Admin can manage users." };
const bool = (v: unknown) => v === true;

function cleanFields(input: { first: unknown; last: unknown; email: unknown }) {
  const first = cleanName(input.first);
  const last = cleanName(input.last);
  if (!first || !last) throw new UserError("Enter a first and last name (letters only).");
  const emailText = typeof input.email === "string" ? input.email.trim() : "";
  const email = emailText ? cleanEmail(emailText) : null;
  if (emailText && !email) throw new UserError("That email doesn't look right.");
  return { first, last, email };
}

// Sets Thunder Coach. Granting it clears a pending request.
async function setThunderCoach(q: Queryable, coachId: string, coach: boolean, who: string) {
  await q.query("select set_role($1, 'thunder', 'Coach', $2, $3)", [coachId, coach, who]);
  if (coach) await q.query("select set_role($1, 'thunder', 'Request', false, $2)", [coachId, who]);
}

export type EditUserInput = { first: unknown; last: unknown; email: unknown; active: unknown; coach: unknown };

export async function updateUser(deps: Deps, viewer: SessionUser, coachId: string, input: EditUserInput): Promise<Result> {
  if (!isThunderAdmin(viewer)) return directorOnly;
  if (!/^\d{7}$/.test(coachId)) return { ok: false, message: "That user no longer exists." };
  return run(async () => {
    const f = cleanFields(input);
    const active = bool(input.active);
    const coach = bool(input.coach);
    if (coachId === viewer.coachId && !active) throw new UserError("You can't deactivate yourself.");
    return withTx(deps.pool, async (q) => {
      const r = await q.query(
        `update users set first_name = $2, last_name = $3, email = $4, active = $5, updated_at = $6, updated_by = $7
         where coach_id = $1`,
        [coachId, f.first, f.last, f.email, active, deps.now(), by(viewer)],
      );
      if (!r.rowCount) throw new UserError("That user no longer exists.");
      await setThunderCoach(q, coachId, coach, by(viewer));
      return {};
    });
  });
}

// Deny an access request: clears the request without giving a role.
export async function denyRequest(deps: Deps, viewer: SessionUser, coachId: string): Promise<Result> {
  if (!isThunderAdmin(viewer)) return directorOnly;
  if (!/^\d{7}$/.test(coachId)) return { ok: false, message: "That user no longer exists." };
  await withTx(deps.pool, async (q) => {
    const r = await q.query("update users set updated_at = $2, updated_by = $3 where coach_id = $1", [coachId, deps.now(), by(viewer)]);
    if (r.rowCount) await q.query("select set_role($1, 'thunder', 'Request', false, $2)", [coachId, by(viewer)]);
  });
  return { ok: true };
}

export type AddUserInput = { first: unknown; last: unknown; cell: unknown; email: unknown; coach: unknown };

// A new login with the starter PIN (1234). Refuses a cell that's taken or whose last 7 digits belong to someone else.
export async function addUser(deps: Deps, viewer: SessionUser, input: AddUserInput): Promise<Result<{ coachId: string }>> {
  if (!isThunderAdmin(viewer)) return directorOnly;
  return run(async () => {
    const f = cleanFields(input);
    const cell = typeof input.cell === "string" ? normalizeCell(input.cell) : null;
    if (!cell) throw new UserError("Enter a 10-digit cell number.");
    const coachId = coachIdFromCell(cell);
    return withTx(deps.pool, async (q) => {
      await q.query("select pg_advisory_xact_lock(hashtext('user:' || $1))", [coachId]);
      const e = await q.query<{ cell: string; who: string }>("select cell, first_name || ' ' || last_name as who from users where coach_id = $1", [
        coachId,
      ]);
      if (e.rows[0]?.cell === cell) throw new UserError(`${e.rows[0].who} already has that cell number.`);
      if (e.rows[0]) throw new UserError(`That cell ends in the same 7 digits as ${e.rows[0].who}'s. Please contact support.`);
      await q.query(
        `insert into users (coach_id, first_name, last_name, cell, email, created_at, updated_at, updated_by)
         values ($1, $2, $3, $4, $5, $6, $6, $7)`,
        [coachId, f.first, f.last, cell, f.email, deps.now(), by(viewer)],
      );
      await setThunderCoach(q, coachId, bool(input.coach), by(viewer));
      return { coachId };
    });
  });
}

// Reset login: back to starter PIN 1234 with no email, logged out everywhere, PIN lockout cleared.
// At their next login they give an email, confirm it with a code, and choose a new PIN.
export async function resetLogin(deps: Deps, viewer: SessionUser, coachId: string): Promise<Result> {
  if (!isThunderAdmin(viewer)) return directorOnly;
  if (!/^\d{7}$/.test(coachId)) return { ok: false, message: "That user no longer exists." };
  if (coachId === viewer.coachId) return { ok: false, message: "You can't reset your own login." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const r = await q.query<{ cell: string }>(
        `update users set pin_hash = null, email = null, verified_email = null, updated_at = $2, updated_by = $3
         where coach_id = $1 returning cell`,
        [coachId, deps.now(), by(viewer)],
      );
      if (!r.rows[0]) throw new UserError("That user no longer exists.");
      await q.query("delete from sessions where coach_id = $1", [coachId]);
      await q.query("delete from pin_lockouts where cell = $1", [r.rows[0].cell]);
      await q.query("delete from email_codes where cell = $1", [r.rows[0].cell]);
      return {};
    }),
  );
}

// Why a user can't be deleted, or null if they can. Deactivate is the safe alternative.
export function deleteBlocker(u: { coachId: string; teams: unknown[]; scenicCity: boolean }, viewer: SessionUser): string | null {
  if (u.coachId === viewer.coachId) return "You can't delete yourself.";
  if (u.teams.length) return "They're on a team. Remove them from their teams first, or deactivate them.";
  if (u.scenicCity) return "Scenic City also uses this person. Deactivate them instead.";
  return null;
}

export async function deleteUser(deps: Deps, viewer: SessionUser, coachId: string): Promise<Result> {
  if (!isThunderAdmin(viewer)) return directorOnly;
  if (!/^\d{7}$/.test(coachId)) return { ok: false, message: "That user no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const r = await q.query<{ scenic: boolean; teams: string[] }>(
        `select exists (select 1 from org_roles o where o.coach_id = users.coach_id and o.org = 'scenic-city') as scenic,
                array(select team_id::text from team_staff where coach_id = users.coach_id) as teams
         from users where coach_id = $1 for update`,
        [coachId],
      );
      if (!r.rows[0]) throw new UserError("That user no longer exists.");
      const blocker = deleteBlocker({ coachId, teams: r.rows[0].teams, scenicCity: r.rows[0].scenic }, viewer);
      if (blocker) throw new UserError(blocker);
      await q.query("delete from users where coach_id = $1", [coachId]); // sessions go with them
      return {};
    }),
  );
}
