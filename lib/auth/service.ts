// Login rules (SPEC.md section 1). Every function re-checks everything on the server;
// the browser only tells us which step the person is on.
import type { Pool, PoolClient } from "pg";
import { withTx, type Queryable } from "../sql";
import { coachIdFromCell, normalizeCell } from "../phone";
import { STARTER_PIN, hashCode, hashPin, isStarterPin, newCode, newSessionToken, sha256, verifyPin } from "./crypto";
import { cleanEmail, cleanName, isCode, isPin, maskEmail } from "./validate";
import { AREAS, type Area } from "../org-admin";

// Same device stays logged in this long after entering the PIN; then the PIN is asked again.
export const SESSION_HOURS = 72;
export const CODE_MINUTES = 15;
export const CODE_MAX_TRIES = 5;
export const CODES_PER_HOUR = 3;
export const PIN_MAX_TRIES = 5;
export const LOCKOUT_MINUTES = 15;

const MINUTE = 60_000;

export type Deps = {
  pool: Pool;
  sendEmail: (to: string, subject: string, text: string) => Promise<void>;
  now: () => Date;
  // Local testing only: starter PIN 1234 logs straight in (no email code). Never on in production.
  devStarterBypass?: boolean;
  // Local testing only: every code is this value, no email is sent, no emails-per-hour limit.
  devFixedCode?: string;
  // Until go-live: a chosen PIN logs straight in, with no email check. Starter PIN 1234 still sets a new PIN
  // with an email code, and new numbers still verify their email (Create Account).
  pinOnly?: boolean;
};

export type Step =
  | { step: "create" }
  | { step: "pin" }
  | { step: "starterEmail" }
  | { step: "starterCode"; maskedEmail: string }
  | { step: "verifyChoice"; maskedEmail: string | null }
  | { step: "verifyCode"; maskedEmail: string }
  | { step: "signupCode"; maskedEmail: string }
  | { step: "resetCode"; maskedEmail: string }
  | { step: "devCode" }
  | { step: "done"; message: string }
  | { step: "loggedIn"; token: string; expiresAt: Date }
  | { step: "error"; message: string };

type Purpose = "signup" | "starter" | "verify" | "reset" | "team";

export type UserRow = {
  coach_id: string;
  first_name: string;
  last_name: string;
  active: boolean;
  pin_hash: string | null;
  cell: string;
  email: string | null;
  verified_email: string | null;
  thunder_coach: boolean;
  thunder_director: boolean;
  thunder_family: boolean;
  thunder_admin: boolean;
  thunder_areas: Area[]; // Director areas in Thunder (SPEC section 14)
  on_team: boolean; // holds any team staff role (HeadCoach, AsstCoach, Manager, TeamParent)
  any_role: boolean; // a role (not just a Request) in any organization
  any_request: boolean; // a pending Request in any organization
};

export type SessionUser = {
  coachId: string;
  firstName: string;
  lastName: string;
  isDirector: boolean;
  // Thunder Director areas (Players, Teams, Facilities, Programs, Officials): what this Director manages. Admins have all.
  // Check with hasArea() in lib/org-admin.ts.
  thunderAreas?: Area[];
  // Thunder Admin: runs Thunder (Users, view as someone, every area). Check with isThunderAdmin() in lib/org-admin.ts.
  isAdmin?: boolean;
  // Thunder Family (signed up as a new family): logs in to see their players from registration.
  isFamily?: boolean;
  isCoach: boolean;
  requestPending: boolean;
  hasThunderRole: boolean;
  // Set when a Director is viewing the app as this user ("Act as"): who is really logged in. View only.
  actingBy?: { coachId: string; name: string };
};

const err = (message: string): Step => ({ step: "error", message });

export const MSG = {
  badPhone: "Enter a 10-digit cell number.",
  deactivated: "Account deactivated. Please contact the Director.",
  pending: "Your request is still pending. The Director will review it.",
  requested: "Request pending. The Director will review it.",
  locked: `Too many wrong PINs. Try again in ${LOCKOUT_MINUTES} minutes, or tap "Forgot PIN?".`,
  noVerifiedEmail: "There's no verified email on file. Please contact the Director.",
  codeExpired: 'That code has expired. Tap "Send a new code".',
  codeDead: 'Too many wrong tries. Tap "Send a new code".',
  badCode: "Enter the 6-digit code from the email.",
  badPin: "PIN must be 4 digits.",
  pinMismatch: "The two PINs don't match.",
  pinStarter: `Choose a PIN other than ${STARTER_PIN}.`,
  badEmail: "Enter a valid email address.",
  badName: "Enter your first and last name (letters only).",
  taken: "That number is already in use. Please contact the Director.",
  askDirector: "Please contact the Director to reset your PIN.",
};

// Verified only when Email = VerifiedEmail.
export function isVerified(u: Pick<UserRow, "email" | "verified_email">): boolean {
  return !!u.email && !!u.verified_email && u.email.trim().toLowerCase() === u.verified_email.trim().toLowerCase();
}

// Coach or Director on the user record, or a place on any team's staff.
function hasThunderRole(u: UserRow): boolean {
  return u.thunder_coach || u.thunder_director || u.on_team;
}

// Roles (from org_roles) and team staff places, read fresh on every request.
const ON_TEAM = `exists (select 1 from team_staff ts where ts.coach_id = u.coach_id) as on_team,
  has_role(u.coach_id, 'thunder', 'Coach') as thunder_coach,
  acts_as(u.coach_id, 'thunder', 'Director') as thunder_director,
  acts_as(u.coach_id, 'thunder', 'Admin') as thunder_admin,
  has_role(u.coach_id, 'thunder', 'Family') as thunder_family,
  array(select a.area from director_areas a where a.coach_id = u.coach_id and a.org = 'thunder') as thunder_areas,
  exists (select 1 from org_roles r where r.coach_id = u.coach_id and r.role <> 'Request') as any_role,
  exists (select 1 from org_roles r where r.coach_id = u.coach_id and r.role = 'Request') as any_request`;

// Asked for access somewhere and holds no role anywhere yet (a role in any organization, or a team place, lets them in).
function pending(u: UserRow): boolean {
  return u.any_request && !u.any_role && !u.on_team;
}

// Deactivated / still-pending people can't go any further.
function gate(u: UserRow): Step | null {
  if (!u.active) return { step: "done", message: MSG.deactivated };
  if (pending(u)) return { step: "done", message: MSG.pending };
  return null;
}

export function newPinError(pin1: unknown, pin2: unknown): string | null {
  if (!isPin(pin1) || !isPin(pin2)) return MSG.badPin;
  if (pin1 !== pin2) return MSG.pinMismatch;
  if (pin1 === STARTER_PIN) return MSG.pinStarter;
  return null;
}

async function findUser(q: PoolClient | Pool, cell: string): Promise<UserRow | null> {
  const r = await q.query<UserRow>(`select u.*, ${ON_TEAM} from users u where u.cell = $1`, [cell]);
  return r.rows[0] ?? null;
}

// Serializes everything for one cell number (codes, PIN tries) inside a transaction.
export async function lockCell(q: PoolClient, cell: string) {
  await q.query("select pg_advisory_xact_lock(hashtext($1))", [cell]);
}

// ---- Email codes ----

export async function issueCode(
  deps: Deps,
  q: PoolClient,
  cell: string,
  purpose: Purpose,
  email: string,
  payload: Record<string, unknown> = {},
): Promise<Step | null> {
  const now = deps.now();
  const recent = await q.query<{ created_at: Date }>(
    "select created_at from email_codes where cell = $1 and created_at > $2 order by created_at",
    [cell, new Date(now.getTime() - 60 * MINUTE)],
  );
  if (recent.rows.length >= CODES_PER_HOUR && !deps.devFixedCode) {
    const freeAt = recent.rows[0].created_at.getTime() + 60 * MINUTE;
    const mins = Math.max(1, Math.ceil((freeAt - now.getTime()) / MINUTE));
    return err(`Too many codes sent. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`);
  }

  // Only the newest code for a purpose works.
  await q.query(
    "update email_codes set expires_at = $3 where cell = $1 and purpose = $2 and used_at is null and expires_at > $3",
    [cell, purpose, now],
  );

  const code = deps.devFixedCode ?? newCode();
  await q.query(
    `insert into email_codes (cell, purpose, email, code_hash, payload, created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [cell, purpose, email, hashCode(cell, purpose, code), payload, now, new Date(now.getTime() + CODE_MINUTES * MINUTE)],
  );
  if (deps.devFixedCode) return null;
  // If sending throws, the transaction rolls back and the code doesn't count toward the limit.
  await deps.sendEmail(
    email,
    `Thunder Basketball code: ${code}`,
    `Your Thunder Basketball code is ${code}.\n\nIt expires in ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
  );
  return null;
}

type CodeRow = { id: string; email: string; payload: Record<string, unknown> };

// Checks the newest live code. Wrong tries are counted (and committed) even though nothing else is saved.
export async function checkCode(
  deps: Deps,
  q: PoolClient,
  cell: string,
  purpose: Purpose,
  code: unknown,
): Promise<{ ok: true; row: CodeRow } | { ok: false; step: Step }> {
  if (!isCode(code)) return { ok: false, step: err(MSG.badCode) };
  const now = deps.now();
  const r = await q.query<CodeRow & { code_hash: string; attempts: number }>(
    `select id, email, payload, code_hash, attempts from email_codes
     where cell = $1 and purpose = $2 and used_at is null and expires_at > $3
     order by id desc limit 1 for update`,
    [cell, purpose, now],
  );
  const row = r.rows[0];
  if (!row) return { ok: false, step: err(MSG.codeExpired) };
  if (row.attempts >= CODE_MAX_TRIES) return { ok: false, step: err(MSG.codeDead) };
  if (row.code_hash !== hashCode(cell, purpose, code)) {
    const tries = row.attempts + 1;
    await q.query("update email_codes set attempts = $2 where id = $1", [row.id, tries]);
    const left = CODE_MAX_TRIES - tries;
    return { ok: false, step: err(left > 0 ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.` : MSG.codeDead) };
  }
  await q.query("update email_codes set used_at = $2 where id = $1", [row.id, now]);
  return { ok: true, row };
}

// ---- PIN tries ----

export async function checkPin(deps: Deps, q: PoolClient, user: UserRow, pin: unknown): Promise<Step | null> {
  const now = deps.now();
  await q.query("insert into pin_lockouts (cell) values ($1) on conflict do nothing", [user.cell]);
  const r = await q.query<{ failed_count: number; locked_until: Date | null }>(
    "select failed_count, locked_until from pin_lockouts where cell = $1 for update",
    [user.cell],
  );
  let { failed_count } = r.rows[0];
  const { locked_until } = r.rows[0];
  if (locked_until && locked_until > now) return err(MSG.locked);
  if (locked_until) failed_count = 0; // lock has run out: fresh start

  // No PIN stored means the starter PIN 1234.
  if (isPin(pin) && (user.pin_hash ? await verifyPin(pin, user.pin_hash) : pin === STARTER_PIN)) {
    await q.query("update pin_lockouts set failed_count = 0, locked_until = null where cell = $1", [user.cell]);
    return null;
  }

  failed_count += 1;
  if (failed_count >= PIN_MAX_TRIES) {
    await q.query("update pin_lockouts set failed_count = 0, locked_until = $2 where cell = $1", [
      user.cell,
      new Date(now.getTime() + LOCKOUT_MINUTES * MINUTE),
    ]);
    return err(MSG.locked);
  }
  await q.query("update pin_lockouts set failed_count = $2, locked_until = null where cell = $1", [user.cell, failed_count]);
  const left = PIN_MAX_TRIES - failed_count;
  return err(`Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left.`);
}

// ---- Sessions ----

export async function startSession(deps: Deps, q: PoolClient | Pool, coachId: string): Promise<Step> {
  const now = deps.now();
  const token = newSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * MINUTE);
  await q.query("delete from sessions where coach_id = $1 and expires_at <= $2", [coachId, now]);
  await q.query("update users set last_login_at = $2 where coach_id = $1", [coachId, now]); // for the Home metrics
  await q.query("insert into sessions (token_hash, coach_id, created_at, expires_at) values ($1, $2, $3, $4)", [
    sha256(token),
    coachId,
    now,
    expiresAt,
  ]);
  return { step: "loggedIn", token, expiresAt };
}

// Roles come straight from the user record on every call, so a removed role takes effect at once.
export async function getSessionUser(deps: Deps, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const r = await deps.pool.query<UserRow & { acting_as: string | null }>(
    `select u.*, ${ON_TEAM}, s.acting_as from sessions s join users u on u.coach_id = s.coach_id
     where s.token_hash = $1 and s.expires_at > $2`,
    [sha256(token), deps.now()],
  );
  const real = r.rows[0];
  if (!real || !real.active) return null;
  // Act as: only while the real person is still an Admin of an organization the other person is in, and they're active.
  if (real.acting_as && real.acting_as !== real.coach_id) {
    const t = await deps.pool.query<UserRow>(
      `select u.*, ${ON_TEAM} from users u where u.coach_id = $1 and u.active and ${CAN_VIEW_AS("$2", "$1")}`,
      [real.acting_as, real.coach_id],
    );
    if (t.rows[0])
      return { ...toSessionUser(t.rows[0]), actingBy: { coachId: real.coach_id, name: `${real.first_name} ${real.last_name}` } };
  }
  return toSessionUser(real);
}

// An Admin may view the app as anyone in their organization: anyone with a role (or Request) there, its officials, or,
// for Thunder, anyone on a team's staff. CourtCaptain staff (support for every organization) may view as anyone. SQL condition on the
// two coach ids.
// (Wrapped in parentheses: it's combined with `and` in queries.)
const CAN_VIEW_AS = (admin: string, target: string) => `(exists (select 1 from platform_admins p where p.coach_id = ${admin})
  or exists (
  select 1 from org_roles a where a.coach_id = ${admin} and a.role = 'Admin'
    and (exists (select 1 from org_roles t where t.coach_id = ${target} and t.org = a.org)
         or exists (select 1 from org_officials f where f.coach_id = ${target} and f.org = a.org)
         or (a.org = 'thunder' and exists (select 1 from team_staff ts where ts.coach_id = ${target})))))`;

// Can this Admin see this person (View as, their dashboard)? Anyone in an organization they're an Admin of.
export async function adminCanSee(q: Pick<Queryable, "query">, adminId: string, targetId: string): Promise<boolean> {
  if (!/^\d{7}$/.test(targetId)) return false;
  const r = await q.query<{ ok: boolean }>(`select ${CAN_VIEW_AS("$1", "$2")} as ok`, [adminId, targetId]);
  return r.rows[0].ok;
}

// Admins: view the app as another user in their organization (view only), or stop.
export async function setActingAs(
  deps: Deps,
  token: string | undefined,
  coachId: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!token) return { ok: false, message: "Please log in again." };
  const s = await deps.pool.query<{ coach_id: string; director: boolean }>(
    `select s.coach_id, u.active and (exists (select 1 from org_roles a where a.coach_id = u.coach_id and a.role = 'Admin')
              or exists (select 1 from platform_admins p where p.coach_id = u.coach_id)) as director
     from sessions s join users u on u.coach_id = s.coach_id
     where s.token_hash = $1 and s.expires_at > $2`,
    [sha256(token), deps.now()],
  );
  const me = s.rows[0];
  if (!me) return { ok: false, message: "Please log in again." };
  if (coachId === null) {
    await deps.pool.query("update sessions set acting_as = null where token_hash = $1", [sha256(token)]);
    return { ok: true };
  }
  if (!me.director) return { ok: false, message: "Only an Admin can view the app as someone else." };
  if (!/^\d{7}$/.test(coachId) || coachId === me.coach_id) return { ok: false, message: "Pick someone else." };
  const t = await deps.pool.query<{ ok: boolean }>(
    `select ${CAN_VIEW_AS("$2", "$1")} as ok from users where coach_id = $1 and active`,
    [coachId, me.coach_id],
  );
  if (!t.rows[0]) return { ok: false, message: "Only active users can be viewed." };
  if (!t.rows[0].ok) return { ok: false, message: "You can only view people in your organization." };
  await deps.pool.query("update sessions set acting_as = $2 where token_hash = $1", [sha256(token), coachId]);
  return { ok: true };
}

function toSessionUser(u: UserRow): SessionUser {
  return {
    coachId: u.coach_id,
    firstName: u.first_name,
    lastName: u.last_name,
    isDirector: u.thunder_director,
    thunderAreas: !u.thunder_director
      ? []
      : u.thunder_admin
        ? AREAS.map((a) => a.key)
        : u.thunder_areas.filter((a) => AREAS.some((x) => x.key === a)),
    isAdmin: u.thunder_director && u.thunder_admin,
    isFamily: u.thunder_family,
    isCoach: u.thunder_coach,
    requestPending: pending(u),
    hasThunderRole: hasThunderRole(u),
  };
}

export async function logout(deps: Deps, token: string | undefined): Promise<void> {
  if (token) await deps.pool.query("delete from sessions where token_hash = $1", [sha256(token)]);
}

// ---- Steps ----

// Step 1: enter phone.
export async function lookupPhone(deps: Deps, cellInput: unknown): Promise<Step> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err(MSG.badPhone);
  const user = await findUser(deps.pool, cell);
  if (!user) return { step: "create" };
  if (deps.devStarterBypass && user.active) return { step: "devCode" };
  const blocked = gate(user);
  if (blocked) return blocked;
  if (await isStarterPin(user.pin_hash)) {
    // Starter PIN: skip the PIN step. Code goes to the email on file, or ask for one.
    if (!user.email) return { step: "starterEmail" };
    return sendStarterCode(deps, cell, null);
  }
  return { step: "pin" };
}

// Starter PIN: send the Set Your PIN code. emailInput is only used when there's no email on file.
export async function sendStarterCode(deps: Deps, cellInput: unknown, emailInput: unknown): Promise<Step> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err(MSG.badPhone);
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const user = await findUser(q, cell);
    if (!user) return { step: "create" };
    const blocked = gate(user);
    if (blocked) return blocked;
    if (!(await isStarterPin(user.pin_hash))) return { step: "pin" };
    const email = user.email ? user.email.trim().toLowerCase() : cleanEmail(emailInput);
    if (!email) return err(MSG.badEmail);
    const fail = await issueCode(deps, q, cell, "starter", email);
    return fail ?? { step: "starterCode", maskedEmail: maskEmail(email) };
  });
}

// Set Your PIN: code + new PIN twice. Saves the PIN and the (now verified) email, then logs in.
export async function completeStarter(
  deps: Deps,
  cellInput: unknown,
  code: unknown,
  pin1: unknown,
  pin2: unknown,
): Promise<Step> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err(MSG.badPhone);
  const pinError = newPinError(pin1, pin2);
  if (pinError) return err(pinError);
  const pinHash = await hashPin(pin1 as string);
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const user = await findUser(q, cell);
    if (!user) return { step: "create" };
    const blocked = gate(user);
    if (blocked) return blocked;
    if (!(await isStarterPin(user.pin_hash))) return { step: "pin" };
    const c = await checkCode(deps, q, cell, "starter", code);
    if (!c.ok) return c.step;
    await q.query("update users set pin_hash = $2, email = $3, verified_email = $3, updated_at = $4 where coach_id = $1", [
      user.coach_id,
      pinHash,
      c.row.email,
      deps.now(),
    ]);
    await q.query("delete from pin_lockouts where cell = $1", [cell]);
    return startSession(deps, q, user.coach_id);
  });
}

// Step: enter PIN.
export async function submitPin(deps: Deps, cellInput: unknown, pin: unknown): Promise<Step> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err(MSG.badPhone);
  const result = await withTx(deps.pool, async (q): Promise<Step | "starter"> => {
    await lockCell(q, cell);
    const user = await findUser(q, cell);
    if (!user) return { step: "create" };
    const blocked = gate(user);
    if (blocked) return blocked;
    // 1234 never logs anyone in (except with the local testing bypass).
    if (await isStarterPin(user.pin_hash)) {
      if (deps.devStarterBypass && pin === STARTER_PIN) return startSession(deps, q, user.coach_id);
      return "starter";
    }
    const wrong = await checkPin(deps, q, user, pin);
    if (wrong) return wrong;
    if (!deps.pinOnly && !isVerified(user))
      return { step: "verifyChoice", maskedEmail: user.email ? maskEmail(user.email) : null };
    return startSession(deps, q, user.coach_id);
  });
  return result === "starter" ? lookupPhone(deps, cell) : result;
}

// Correct PIN, email not verified: send a code to the email on file, or to a new one.
export async function sendVerifyCode(deps: Deps, cellInput: unknown, pin: unknown, emailInput: unknown): Promise<Step> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err(MSG.badPhone);
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const user = await findUser(q, cell);
    if (!user) return { step: "create" };
    const blocked = gate(user);
    if (blocked) return blocked;
    if (await isStarterPin(user.pin_hash)) return { step: "pin" };
    const wrong = await checkPin(deps, q, user, pin);
    if (wrong) return wrong;
    if (isVerified(user)) return startSession(deps, q, user.coach_id);
    const email = emailInput ? cleanEmail(emailInput) : user.email?.trim().toLowerCase() || null;
    if (!email) return err(MSG.badEmail);
    const fail = await issueCode(deps, q, cell, "verify", email);
    return fail ?? { step: "verifyCode", maskedEmail: maskEmail(email) };
  });
}

export async function completeVerify(deps: Deps, cellInput: unknown, pin: unknown, code: unknown): Promise<Step> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err(MSG.badPhone);
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const user = await findUser(q, cell);
    if (!user) return { step: "create" };
    const blocked = gate(user);
    if (blocked) return blocked;
    if (await isStarterPin(user.pin_hash)) return { step: "pin" };
    const wrong = await checkPin(deps, q, user, pin);
    if (wrong) return wrong;
    const c = await checkCode(deps, q, cell, "verify", code);
    if (!c.ok) return c.step;
    await q.query("update users set email = $2, verified_email = $2, updated_at = $3 where coach_id = $1", [
      user.coach_id,
      c.row.email,
      deps.now(),
    ]);
    return startSession(deps, q, user.coach_id);
  });
}

// Forgot PIN: code goes only to the verified email. Works while locked out.
export async function startForgot(deps: Deps, cellInput: unknown): Promise<Step> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err(MSG.badPhone);
  if (deps.pinOnly) return err(MSG.askDirector);
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const user = await findUser(q, cell);
    if (!user) return { step: "create" };
    const blocked = gate(user);
    if (blocked) return blocked;
    if (!isVerified(user)) return err(MSG.noVerifiedEmail);
    const email = user.verified_email!.trim().toLowerCase();
    const fail = await issueCode(deps, q, cell, "reset", email);
    return fail ?? { step: "resetCode", maskedEmail: maskEmail(email) };
  });
}

export async function completeReset(deps: Deps, cellInput: unknown, code: unknown, pin1: unknown, pin2: unknown): Promise<Step> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err(MSG.badPhone);
  const pinError = newPinError(pin1, pin2);
  if (pinError) return err(pinError);
  const pinHash = await hashPin(pin1 as string);
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const user = await findUser(q, cell);
    if (!user) return { step: "create" };
    const blocked = gate(user);
    if (blocked) return blocked;
    if (!isVerified(user)) return err(MSG.noVerifiedEmail);
    const c = await checkCode(deps, q, cell, "reset", code);
    if (!c.ok) return c.step;
    await q.query("update users set pin_hash = $2, updated_at = $3 where coach_id = $1", [user.coach_id, pinHash, deps.now()]);
    await q.query("delete from pin_lockouts where cell = $1", [cell]);
    return startSession(deps, q, user.coach_id);
  });
}

// Organizations with a join link (SPEC.md section 13). Signing up there skips the Thunder request.
// Sign-ups that log straight in, with no Thunder request: the CourtCaptain login, registering a new organization, or
// any organization's login or join link other than Thunder's. Thunder's own login asks why they're joining instead.
async function joinTarget(q: Pick<Queryable, "query">, join: unknown): Promise<string | null> {
  if (join === "courtcaptain" || join === "new-org") return join;
  if (typeof join !== "string" || join === "thunder" || !/^[a-z0-9-]{2,40}$/.test(join)) return null;
  return (await q.query("select 1 from organizations where slug = $1", [join])).rowCount ? join : null;
}

// Create Account: check everything, then email a code. Nothing is saved until the code checks out.
// Why someone is joining Thunder (SPEC.md section 15). New families get the Family role at once; team staff and other
// sign-ups become a request with their reason, for an Admin to approve.
export type JoinReason =
  | { purpose: "family" }
  | {
      purpose: "staff";
      staffRole: "HeadCoach" | "AsstCoach" | "Manager" | "TeamParent";
      teamId: string | null;
      teamText: string | null;
    }
  | { purpose: "other"; notes: string };
export type JoinInput = { purpose?: unknown; staffRole?: unknown; teamId?: unknown; teamText?: unknown; notes?: unknown };

const STAFF_ROLES = ["HeadCoach", "AsstCoach", "Manager", "TeamParent"] as const;
// Short free text: trimmed, single-spaced, never starting like a formula.
const cleanText = (v: unknown, max: number) => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length >= 2 && t.length <= max && !/^[=+\-@]/.test(t) ? t : null;
};

async function cleanJoinReason(q: Queryable, input: JoinInput): Promise<JoinReason | string> {
  if (input.purpose === "family") return { purpose: "family" };
  if (input.purpose === "other") {
    const notes = cleanText(input.notes, 300);
    return notes ? { purpose: "other", notes } : "Tell us a little about why you're joining.";
  }
  if (input.purpose !== "staff") return "Choose why you're joining.";
  const staffRole = STAFF_ROLES.find((r) => r === input.staffRole);
  if (!staffRole) return "Choose your role on the team.";
  if (typeof input.teamId === "string" && /^\d{1,18}$/.test(input.teamId)) {
    const t = await q.query("select 1 from teams where id = $1", [input.teamId]);
    if (!t.rowCount) return "Choose your team.";
    return { purpose: "staff", staffRole, teamId: input.teamId, teamText: null };
  }
  const teamText = cleanText(input.teamText, 60);
  if (!teamText) return "Choose your team, or type it in.";
  // A typed name that is a Thunder team (any capitals) counts as picking it.
  const named = await q.query<{ id: string }>("select id::text from teams where lower(name) = lower($1)", [teamText]);
  return named.rows[0]
    ? { purpose: "staff", staffRole, teamId: named.rows[0].id, teamText: null }
    : { purpose: "staff", staffRole, teamId: null, teamText };
}

export async function startSignup(
  deps: Deps,
  input: {
    cell: unknown;
    firstName: unknown;
    lastName: unknown;
    email: unknown;
    pin1: unknown;
    pin2: unknown;
    join?: unknown;
  } & JoinInput,
): Promise<Step> {
  const cell = typeof input.cell === "string" ? normalizeCell(input.cell) : null;
  if (!cell) return err(MSG.badPhone);
  const firstName = cleanName(input.firstName);
  const lastName = cleanName(input.lastName);
  if (!firstName || !lastName) return err(MSG.badName);
  const email = cleanEmail(input.email);
  if (!email) return err(MSG.badEmail);
  const pinError = newPinError(input.pin1, input.pin2);
  if (pinError) return err(pinError);
  const join = await joinTarget(deps.pool, input.join);
  // Thunder sign-ups say why they're joining; a join link (another organization) asks on its own page.
  const reason = join ? null : await cleanJoinReason(deps.pool, input);
  if (typeof reason === "string") return err(reason);
  const pinHash = await hashPin(input.pin1 as string);
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const clash = await q.query("select 1 from users where cell = $1 or coach_id = $2", [cell, coachIdFromCell(cell)]);
    if (clash.rows.length) return err(MSG.taken);
    const fail = await issueCode(deps, q, cell, "signup", email, { firstName, lastName, pinHash, join, reason });
    return fail ?? { step: "signupCode", maskedEmail: maskEmail(email) };
  });
}

export async function completeSignup(deps: Deps, cellInput: unknown, code: unknown): Promise<Step> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err(MSG.badPhone);
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const c = await checkCode(deps, q, cell, "signup", code);
    if (!c.ok) return c.step;
    const { firstName, lastName, pinHash, join, reason } = c.row.payload as {
      firstName: string;
      lastName: string;
      pinHash: string;
      join?: string | null;
      reason?: JoinReason | null;
    };
    const now = deps.now();
    const ins = await q.query(
      `insert into users (coach_id, first_name, last_name, active, pin_hash, cell, email, verified_email, created_at, updated_at)
       values ($1, $2, $3, true, $4, $5, $6, $6, $7, $7)
       on conflict do nothing`,
      [coachIdFromCell(cell), firstName, lastName, pinHash, cell, c.row.email, now],
    );
    if (!ins.rowCount) return err(MSG.taken);
    // From a join link: logged straight in (no role yet) to choose what they're joining as on that page.
    if (join) return startSession(deps, q, coachIdFromCell(cell));
    if (deps.devStarterBypass) {
      // Testing mode: new accounts are approved Directors and logged straight in.
      await q.query("select set_role($1, 'thunder', 'Director', true, 'testing mode')", [coachIdFromCell(cell)]);
      return startSession(deps, q, coachIdFromCell(cell));
    }
    const coachId = coachIdFromCell(cell);
    // A new family is in at once; team staff and other sign-ups wait for an Admin, with their reason.
    if (reason?.purpose === "family") {
      await q.query("select set_role($1, 'thunder', 'Family', true, 'sign-up')", [coachId]);
      return startSession(deps, q, coachId);
    }
    await q.query("select set_role($1, 'thunder', 'Request', true, null)", [coachId]);
    if (reason)
      await q.query(
        `insert into join_reasons (coach_id, purpose, staff_role, team_id, team_text, notes, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (coach_id) do update set purpose = excluded.purpose, staff_role = excluded.staff_role, team_id = excluded.team_id,
           team_text = excluded.team_text, notes = excluded.notes, created_at = excluded.created_at`,
        [
          coachId,
          reason.purpose,
          reason.purpose === "staff" ? reason.staffRole : null,
          reason.purpose === "staff" ? reason.teamId : null,
          reason.purpose === "staff" ? reason.teamText : null,
          reason.purpose === "other" ? reason.notes : null,
          now,
        ],
      );
    return { step: "done", message: MSG.requested };
  });
}

// Testing mode only: phone + the fixed code logs in. No PIN, no email.
export async function devLogin(deps: Deps, cellInput: unknown, code: unknown): Promise<Step> {
  if (!deps.devStarterBypass || !deps.devFixedCode) return err("Not available.");
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err(MSG.badPhone);
  if (code !== deps.devFixedCode) return err(`Wrong code. In testing mode it's ${deps.devFixedCode}.`);
  const user = await findUser(deps.pool, cell);
  if (!user) return { step: "create" };
  if (!user.active) return { step: "done", message: MSG.deactivated };
  return startSession(deps, deps.pool, user.coach_id);
}

// Logged in, verified, but no Thunder role. They stay logged in and see "pending" on the home page.
export async function requestAccess(deps: Deps, token: string | undefined): Promise<Step> {
  const user = await getSessionUser(deps, token);
  if (!user) return err("Please log in again.");
  if (!user.hasThunderRole) {
    await deps.pool.query("select set_role($1, 'thunder', 'Request', true, null)", [user.coachId]);
  }
  return { step: "done", message: MSG.requested };
}

export { STARTER_PIN };
