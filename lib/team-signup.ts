// Register (SPEC.md section 13): from Scenic City's public League page (or its login page) while it has Team
// Registrations on, anyone registers their organization's teams in a program open for registration, no login first.
// One form: the organization's name (always: every registration makes an organization), the person registering (name,
// cell, email: they become its Owner), then each team (+ Add another team): gender, grade, its Head Coach (them, or
// someone else: name, cell, email), optional Assistant Coach, Manager and Team Parent, and for a League what it registers
// for (ALL Season or Game Days, with the fees). No Level is asked: COMP, or REC where the program has no COMP group for
// its grade. Each team is named by the usual rule for an organization's teams: "8B Testing Basketball Epps" (grade and
// gender, its short name, the Head Coach's last name), or with an optional Alternate name in its place ("8B Bolts Epps"). The person verifies their email
// with a code: a new cell chooses a PIN (their login); a cell with a login enters its PIN. Then the organization (with
// CourtClub on), its teams, their staff and registrations are made all at once (or nothing is), and they're logged in.
import type { PoolClient } from "pg";
import { myAccounts, switchSoloToOrg, type OrgAccount, type SoloAccount } from "./court-solo";
import { copyOf, partnerFor } from "./org-leagues";
import { cleanOrgName, insertOrganization, ORG_COLORS } from "./org-signup";
import { addSignupTeam } from "./org-teams";
import { matchOrCreateUser } from "./user-match";
import {
  checkCode,
  checkPin,
  isVerified,
  issueCode,
  parentEmailIssue,
  lockCell,
  newPinError,
  getSessionUser,
  startSession,
  type Deps,
  type Step,
  type UserRow,
} from "./auth/service";
import { hashPin } from "./auth/crypto";
import { cleanEmail, cleanName, maskEmail } from "./auth/validate";
import { coachIdFromCell, normalizeCell } from "./phone";
import { closedReason, planChoice, type Choice, type ProgramOption } from "./program-options";
import { PROGRAM_LOGO_SQL, leagueEntry, parseChoice, saveChoice } from "./scenic-programs";
import { parseGrade } from "./scenic-teams";
import { cleanPlaceName } from "./scenic-partners";
import { withTx, type Queryable } from "./sql";
import type { StripeApi } from "./stripe/connect";
import { insertPayment, openCheckout, openCheckoutInPage, owed, payee, type InPage, type PayTeam } from "./stripe/registration";
import { easternDate } from "./time";

export const STAFF_ROLES = [
  { key: "AsstCoach", label: "Assistant Coach" },
  { key: "Manager", label: "Manager" },
  { key: "TeamParent", label: "Team Parent" },
] as const;
type StaffRole = (typeof STAFF_ROLES)[number]["key"];
type Staff = { role: StaffRole; first: string; last: string; cell: string; email: string | null };

export type TeamSignupInput = {
  programId: unknown;
  orgName: unknown;
  orgShort?: unknown;
  first: unknown; // the person registering (the organization's Owner)
  last: unknown;
  cell: unknown;
  email: unknown;
  pin?: unknown; // a cell with a login: its PIN
  pin1?: unknown; // a new cell: the PIN they choose
  pin2?: unknown;
  // Each team: { gender, grade, head: "me" | { first, last, cell, email }, staff: [{ role, first, last, cell, email }],
  // choice (a League: { allSeason, days: [{ date, kind }] }) }
  teams: unknown;
};

export const MAX_SIGNUP_TEAMS = 20;

export type HeadCoachInfo = { first: string; last: string; email: string };
export type TeamStep =
  | { step: "pin" } // the cell has a login: its PIN first
  | { step: "resetCode"; maskedEmail: string } // Forgot PIN: a code went to their verified email
  // coach: filled in from their login, after the PIN; accounts: their CourtSolo accounts and organizations (asked first)
  | { step: "form"; existing: boolean; coach?: HeadCoachInfo; accounts?: { solo: SoloAccount[]; orgs: OrgAccount[] } }
  | { step: "code"; maskedEmail: string }
  | Exclude<Step, { step: "loggedIn" }>;

const err = (message: string): TeamStep => ({ step: "error", message });

export type OpenProgram = {
  id: string;
  name: string;
  kind: string;
  startsOn: string;
  endsOn: string;
  regCloses: string;
  logo: string | null; // its logo's link
  recLimited: boolean; // REC open only to the organizations Scenic City picked
  // A League's options and Game Days; recOnly: the groups ("Boys 3") that are only REC there (ALL Season only).
  league: { options: ProgramOption[]; gameDates: string[]; recOnly: string[] } | null;
};

// Programs open for registration today, by start date.
export async function openPrograms(q: Pick<Queryable, "query">, now: Date): Promise<OpenProgram[]> {
  const r = await q.query<Omit<OpenProgram, "league">>(
    `select id::text, name, kind, starts_on::text as "startsOn", ends_on::text as "endsOn", reg_closes::text as "regCloses",
            ${PROGRAM_LOGO_SQL} as logo, rec_limited_by is not null as "recLimited"
       from scenic_programs p
      where reg_opens <= $1::date and reg_closes >= $1::date order by starts_on, lower(name), id`,
    [easternDate(now)],
  );
  return Promise.all(
    r.rows.map(async (p) => {
      if (p.kind !== "League") return { ...p, league: null };
      const { options, gameDates } = await leagueEntry(q, p.id, null);
      const rec = await q.query<{ g: string }>(
        `select d.gender || ' ' || g.grade as g from scenic_divisions d join scenic_grade_groups g on g.division_id = d.id
          where d.program_id = $1 group by d.gender, g.grade having bool_and(g.level = 'REC')`,
        [p.id],
      );
      return { ...p, league: { options, gameDates, recOnly: rec.rows.map((x) => x.g) } };
    }),
  );
}

// The team's level in this program: COMP, or REC where there's no COMP group for its gender and grade.
async function levelIn(q: Pick<Queryable, "query">, programId: string, gender: string, grade: number) {
  const r = await q.query<{ level: string }>(
    `select g.level from scenic_divisions d join scenic_grade_groups g on g.division_id = d.id
      where d.program_id = $1 and (d.gender = $2 or d.gender = 'Coed') and g.grade = $3`,
    [programId, gender, grade],
  );
  const levels = r.rows.map((x) => x.level);
  return levels.includes("COMP") ? "COMP" : levels.includes("REC") ? "REC" : null;
}

// Something that stops the whole registration (nothing kept).
class Stop extends Error {}

// A new organization's name: free among CourtCaptain's organizations (any capitals).
const orgNameTaken = async (q: Pick<Queryable, "query">, name: string) =>
  !!(await q.query("select 1 from organizations where lower(name) = lower($1)", [name])).rowCount;

// Step 1: the person's cell. A cell with a login enters its PIN next (teamSignupPin); a new one goes to the form.
export async function teamSignupLookup(deps: Deps, cellInput: unknown): Promise<TeamStep> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err("Enter your 10-digit cell number.");
  if (!(await openPrograms(deps.pool, deps.now())).length) return err("Team registration isn't open right now.");
  const u = await deps.pool.query<{ active: boolean }>("select active from users where cell = $1", [cell]);
  if (u.rows[0] && !u.rows[0].active) return err("That cell's account is deactivated. Please contact Scenic City.");
  return u.rows[0] ? { step: "pin" } : { step: "form", existing: false };
}

// Step 1b: a cell with a login enters its PIN (the usual tries and lockout). Right, the form opens with the Head Coach's
// name and email from their login. The PIN is checked again when the code is sent.
export async function teamSignupPin(deps: Deps, cellInput: unknown, pin: unknown): Promise<TeamStep> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err("Enter your 10-digit cell number.");
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const u = await q.query<
      UserRow & { first_name: string; last_name: string; email: string | null; verified_email: string | null }
    >("select * from users where cell = $1", [cell]);
    const user = u.rows[0];
    if (!user) return { step: "form" as const, existing: false };
    if (!user.active) return err("That cell's account is deactivated. Please contact Scenic City.");
    const bad = await checkPin(deps, q, user, pin);
    if (bad) return bad as TeamStep;
    const accounts = await myAccounts(q, user.coach_id, easternDate(deps.now()));
    return { step: "form" as const, existing: true, coach: coachInfo(user), accounts };
  });
}

function cleanStaff(v: unknown): Staff[] | string {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > STAFF_ROLES.length) return "Check the team's other staff.";
  const out: Staff[] = [];
  for (const s of v as Record<string, unknown>[]) {
    const role = STAFF_ROLES.find((r) => r.key === s?.role);
    if (!role) return "Check the team's other staff.";
    const label = role.label;
    const blank = [s.first, s.last, s.cell, s.email].every((x) => typeof x !== "string" || !x.trim());
    if (blank) continue; // left empty: optional
    const first = cleanName(s.first);
    const last = cleanName(s.last);
    if (!first || !last) return `${label}: enter a first and last name (letters only), or leave all of it empty.`;
    const cell = typeof s.cell === "string" ? normalizeCell(s.cell) : null;
    if (!cell) return `${label}: enter a 10-digit cell number.`;
    const email = typeof s.email === "string" && s.email.trim() ? cleanEmail(s.email) : null;
    if (typeof s.email === "string" && s.email.trim() && !email) return `${label}: enter a valid email, or leave it empty.`;
    if (out.some((x) => x.role === role.key)) return "Check the team's other staff.";
    out.push({ role: role.key, first, last, cell, email });
  }
  return out;
}

// Forgot PIN (on the PIN step): a code to the login's verified email (shown masked), then a new PIN with it. Like the
// login's Forgot PIN (works while locked out), but it opens the form instead of logging in.
type CoachRow = UserRow & { first_name: string; last_name: string; email: string | null; verified_email: string | null };
const coachInfo = (u: CoachRow) => ({ first: u.first_name, last: u.last_name, email: u.verified_email ?? u.email ?? "" });

export async function teamSignupForgot(deps: Deps, cellInput: unknown): Promise<TeamStep> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err("Enter your 10-digit cell number.");
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const user = (await q.query<CoachRow>("select * from users where cell = $1", [cell])).rows[0];
    if (!user) return { step: "form" as const, existing: false };
    if (!user.active) return err("That cell's account is deactivated. Please contact Scenic City.");
    if (!isVerified(user))
      return err("This login has no confirmed email to send a code to. Please contact Scenic City to reset the PIN.");
    const email = user.verified_email!.trim().toLowerCase();
    const fail = await issueCode(deps, q, cell, "reset", email);
    return (fail as TeamStep | null) ?? { step: "resetCode" as const, maskedEmail: maskEmail(email) };
  });
}

export async function teamSignupReset(
  deps: Deps,
  cellInput: unknown,
  code: unknown,
  pin1: unknown,
  pin2: unknown,
): Promise<TeamStep> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err("Enter your 10-digit cell number.");
  const pinError = newPinError(pin1, pin2);
  if (pinError) return err(pinError);
  const pinHash = await hashPin(pin1 as string);
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const user = (await q.query<CoachRow>("select * from users where cell = $1", [cell])).rows[0];
    if (!user || !user.active || !isVerified(user)) return err("That code didn't work. Start again.");
    const c = await checkCode(deps, q, cell, "reset", code);
    if (!c.ok) return c.step as TeamStep;
    await q.query("update users set pin_hash = $2, updated_at = $3 where coach_id = $1", [user.coach_id, pinHash, deps.now()]);
    await q.query("delete from pin_lockouts where cell = $1", [cell]);
    const accounts = await myAccounts(q, user.coach_id, easternDate(deps.now()));
    return { step: "form" as const, existing: true, coach: coachInfo(user), accounts };
  });
}

type Head = "me" | { first: string; last: string; cell: string; email: string };
type SignupTeam = {
  alt: string | null; // its Alternate name (in its name in place of the organization's)
  gender: "Boys" | "Girls" | "Coed";
  low: number;
  grade: number;
  level: string;
  head: Head;
  staff: Staff[];
  choice: Choice | null;
};

// Each team, checked (gender and grade, its Head Coach, its other staff, and a League's choice); a message when wrong.
async function cleanTeams(
  deps: Deps,
  raw: unknown,
  program: OpenProgram,
  registrant: { cell: string },
): Promise<SignupTeam[] | string> {
  if (!Array.isArray(raw) || !raw.length) return "Add a team.";
  if (raw.length > MAX_SIGNUP_TEAMS) return `Register up to ${MAX_SIGNUP_TEAMS} teams at a time.`;
  const today = easternDate(deps.now());
  const out: SignupTeam[] = [];
  for (const [i, v] of (raw as Record<string, unknown>[]).entries()) {
    const label = raw.length > 1 ? `Team ${i + 1}: ` : "";
    const gender = v?.gender === "Boys" || v?.gender === "Girls" || v?.gender === "Coed" ? v.gender : null;
    if (!gender) return `${label}Pick Boys or Girls.`;
    const g = parseGrade(v.grade);
    if (!g) return `${label}Pick a grade.`;
    // Pre-K (ages 3 and 4) teams are Coed; Coed teams are Pre-K.
    if (g.grade === -1 && gender !== "Coed") return `${label}Pre-K teams are Coed.`;
    if (g.grade !== -1 && gender === "Coed") return `${label}Only Pre-K teams are Coed; pick Boys or Girls.`;
    const level = await levelIn(deps.pool, program.id, gender, g.grade);
    if (!level) return `${label}${program.name} has no group for ${gender} in this grade.`;
    if (level === "REC" && program.recLimited) return `${label}REC in ${program.name} is for invited organizations only.`;
    let head: Head = "me";
    if (v.head !== "me") {
      const h = v.head as Record<string, unknown> | null;
      const first = cleanName(h?.first);
      const last = cleanName(h?.last);
      if (!first || !last) return `${label}Enter the Head Coach's first and last name (letters only).`;
      const cell = typeof h?.cell === "string" ? normalizeCell(h.cell) : null;
      if (!cell) return `${label}Enter the Head Coach's 10-digit cell number.`;
      const email = cleanEmail(h?.email);
      if (!email) return `${label}Enter the Head Coach's email.`;
      head = cell === registrant.cell ? "me" : { first, last, cell, email };
    }
    // Its optional Alternate name: in its name in place of the organization's ("8B Bolts Epps").
    const alt = typeof v.alt === "string" && v.alt.trim() ? cleanPlaceName(v.alt) : null;
    if (typeof v.alt === "string" && v.alt.trim() && !alt)
      return `${label}Alternate name: letters, numbers and simple punctuation, up to 60 characters.`;
    const staff = cleanStaff(v.staff);
    if (typeof staff === "string") return `${label}${staff}`;
    let choice: Choice | null = null;
    if (program.league) {
      choice = parseChoice(v.choice);
      if (!choice || (!choice.allSeason && !choice.days.length)) return `${label}Pick ALL Season or at least one date.`;
      if (choice.days.some((d) => d.date < today)) return `${label}Past Game Days can't be picked.`;
      const none = { allSeason: false, days: [] };
      const plan = planChoice(program.league.options, program.league.gameDates, none, choice);
      if ("error" in plan) return `${label}${plan.error}`;
      const closed = closedReason(program.league.options, program.league.gameDates, none, choice, today);
      if (closed) return `${label}${closed}`;
    }
    out.push({ alt, gender, low: g.low, grade: g.grade, level, head, staff, choice });
  }
  return out;
}

// Step 2: check everything, then email the person registering a code. Nothing is saved until the code checks out.
export async function teamSignupStart(deps: Deps, input: TeamSignupInput): Promise<TeamStep> {
  const orgName = cleanOrgName(input.orgName, 60);
  if (!orgName) return err("Enter your organization's name: letters, numbers and simple punctuation.");
  const orgShort =
    typeof input.orgShort === "string" && input.orgShort.trim() ? cleanOrgName(input.orgShort, 20) : orgName.length <= 20 ? orgName : null;
  if (!orgShort) return err('Enter a short name for your organization (up to 20 characters), e.g. "Hixson Hoops".');
  const first = cleanName(input.first);
  const last = cleanName(input.last);
  if (!first || !last) return err("Enter your first and last name (letters only).");
  const cell = typeof input.cell === "string" ? normalizeCell(input.cell) : null;
  if (!cell) return err("Enter your 10-digit cell number.");
  const email = cleanEmail(input.email);
  if (!email) return err("Enter your email.");
  const program = (await openPrograms(deps.pool, deps.now())).find((x) => x.id === input.programId);
  if (!program) return err("Pick a program open for registration.");
  const teams = await cleanTeams(deps, input.teams, program, { cell });
  if (typeof teams === "string") return err(teams);
  if (await orgNameTaken(deps.pool, orgName)) return err(`There's already an organization named ${orgName} on CourtCaptain.`);
  return withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const u = await q.query<Pick<UserRow, "coach_id" | "active" | "pin_hash" | "cell" | "first_name" | "last_name">>(
      "select coach_id, active, pin_hash, cell, first_name, last_name from users where cell = $1",
      [cell],
    );
    const user = u.rows[0];
    let pinHash: string | null = null;
    if (user) {
      if (!user.active) return err("That cell's account is deactivated. Please contact Scenic City.");
      const bad = await checkPin(deps, q, user as UserRow, input.pin);
      if (bad) return bad as TeamStep; // a wrong PIN or a lockout
    } else {
      const clash = await q.query("select 1 from users where coach_id = $1", [coachIdFromCell(cell)]);
      if (clash.rowCount) return err("That number is already in use. Please contact Scenic City.");
      const notTheirs = await parentEmailIssue(q, cell, email); // a parent's cell: the email on that registration
      if (notTheirs) return err(notTheirs);
      const pinError = newPinError(input.pin1, input.pin2);
      if (pinError) return err(pinError);
      pinHash = await hashPin(input.pin1 as string);
    }
    const payload: Payload = {
      programId: program.id,
      org: { name: orgName, short: orgShort },
      teams,
      first: user ? user.first_name : first, // a login keeps its own name
      last: user ? user.last_name : last,
      pinHash,
      existing: !!user,
    };
    const fail = await issueCode(deps, q, cell, "team", email, payload as unknown as Record<string, unknown>);
    return (fail as TeamStep | null) ?? { step: "code", maskedEmail: maskEmail(email) };
  });
}

type Payload = {
  programId: string;
  org: { name: string; short: string };
  teams: SignupTeam[];
  first: string;
  last: string;
  pinHash: string | null;
  existing: boolean;
};

// Step 3: the code. Makes the login (or confirms the email of the one there), the organization, its teams and their
// registrations; logs them in. When the League takes cards and the teams cost something (`pay`: Stripe and this site's
// address), the teams are registered once it's paid: `pay` in the answer is Stripe Checkout's address (one payment for
// all the teams). If Checkout can't open, they're logged in with their teams made but not registered (Register ALL Teams).
export async function teamSignupComplete(
  deps: Deps,
  cellInput: unknown,
  code: unknown,
  pay?: { stripe: StripeApi | null; base: string; inPage?: boolean },
): Promise<
  TeamStep | { step: "loggedIn"; token: string; expiresAt: Date; programId: string; slug: string; pay?: string; payInPage?: InPage }
> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err("Enter your 10-digit cell number.");
  // The code is checked (and a wrong try counted) on its own; the rest goes in all at once or not at all.
  const c = await withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    return checkCode(deps, q, cell, "team", code);
  });
  if (!c.ok) return c.step as TeamStep; // a wrong or expired code
  const p = c.row.payload as unknown as Payload;
  if (!p?.org || !Array.isArray(p.teams)) return err("That registration is from before an update. Start again.");
  let done;
  try {
    done = await withTx(deps.pool, (q) => registerAll(deps, q, cell, p, c.row.email, pay?.stripe ?? null));
  } catch (e) {
    if (e instanceof Stop) return err(`${e.message} Start again.`);
    throw e;
  }
  const { paymentId, ...s } = done;
  if (!paymentId || !pay?.stripe) return s;
  try {
    const home = `/org/${encodeURIComponent(s.slug)}`;
    // Stripe's form in the page (the Register form shows it; Cancel goes to its Home, teams waiting in Register ALL).
    if (pay.inPage) return { ...s, payInPage: await openCheckoutInPage({ pool: deps.pool, stripe: pay.stripe, now: deps.now }, paymentId, pay.base) };
    const url = await openCheckout({ pool: deps.pool, stripe: pay.stripe, now: deps.now }, paymentId, pay.base, `${home}?open=register&paid=cancelled`);
    return { ...s, pay: url };
  } catch (e) {
    console.error("Stripe Checkout didn't open for a new registration:", e);
    return s; // logged in; their teams wait in Register ALL Teams
  }
}

async function registerAll(deps: Deps, q: PoolClient, cell: string, p: Payload, email: string, stripe: StripeApi | null) {
  const now = deps.now();
  const to = await payee(q, stripe); // the League takes cards: register once it's paid
  await lockCell(q, cell);
  // One new organization name at a time.
  await q.query("select pg_advisory_xact_lock(hashtext('org-names'))");
  if (await orgNameTaken(q, p.org.name)) throw new Stop(`There's already an organization named ${p.org.name}.`);
  const open = await q.query(
    "select 1 from scenic_programs where id = $1 and reg_opens <= $2::date and reg_closes >= $2::date for share",
    [p.programId, easternDate(now)],
  );
  if (!open.rowCount) throw new Stop("Registration for that program has closed.");
  const coachId = await headCoach(q, cell, p, email, now);
  if (!coachId) throw new Stop("That number is already in use. Please contact Scenic City.");
  const who = `${p.first} ${p.last}`;
  const slug = await insertOrganization(q, {
    name: p.org.name,
    short: p.org.short,
    kind: "Organization",
    color: ORG_COLORS[0],
    logo: null,
    byName: who,
    ownerId: coachId,
    now,
    on: ["court-club"],
  });
  const partner = await partnerFor(q, slug, who);
  const toPay: PayTeam[] = [];
  const person = async (x: { first: string; last: string; cell: string; email: string | null }) => {
    const m = await matchOrCreateUser(q, x, now);
    if ("error" in m) throw new Stop(m.error);
    return { coachId: m.coachId, lastName: m.lastName };
  };
  for (const [i, t] of p.teams.entries()) {
    const head = t.head === "me" ? { coachId, lastName: p.last } : await person(t.head);
    const staff = [{ ...head, role: "HeadCoach" as const }];
    for (const s of t.staff) staff.push({ ...(await person(s)), role: s.role as never });
    const team = await addSignupTeam(q, slug, t, staff, who, now);
    const copy = await copyOf(q, team.id, partner, who, now);
    const label = p.teams.length > 1 ? `Team ${i + 1}: ` : "";
    if (to) {
      // What it costs (its registration tried, then undone): registered once it's paid.
      await q.query("savepoint owe");
      const cost = await owed(q, p.programId, copy, t.choice ?? undefined, who, now);
      await q.query("rollback to savepoint owe");
      if ("error" in cost) throw new Stop(`${label}${cost.error}`);
      toPay.push({ teamId: copy, orgTeamId: team.id, choice: t.choice ?? undefined, cents: cost.cents });
    } else {
      const placed = await saveChoice(q, p.programId, copy, t.choice ?? undefined, who, now);
      if ("error" in placed) throw new Stop(`${label}${placed.error}`);
    }
  }
  let paymentId: string | null = null;
  if (to && toPay.some((t) => t.cents > 0))
    paymentId = await insertPayment(q, to, { programId: p.programId, teamOrg: slug, teams: toPay, startedBy: who, now });
  else
    for (const [i, t] of toPay.entries()) {
      // Nothing to pay after all: registered now.
      const placed = await saveChoice(q, p.programId, t.teamId, t.choice, who, now);
      if ("error" in placed) throw new Stop(`${p.teams.length > 1 ? `Team ${i + 1}: ` : ""}${placed.error}`);
    }
  const s = await startSession(deps, q, coachId);
  if (s.step !== "loggedIn") throw new Stop("Couldn't log in.");
  return { ...s, programId: p.programId, slug, paymentId };
}

// The person registering's login: a new one with their PIN and verified email, or the one there with this email now verified.
async function headCoach(q: PoolClient, cell: string, p: Payload, email: string, now: Date): Promise<string | null> {
  if (p.existing) {
    const r = await q.query<{ coach_id: string }>(
      "update users set email = $2, verified_email = $2, updated_at = $3 where cell = $1 and active returning coach_id",
      [cell, email, now],
    );
    return r.rows[0]?.coach_id ?? null;
  }
  const coachId = coachIdFromCell(cell);
  const r = await q.query(
    `insert into users (coach_id, first_name, last_name, active, pin_hash, cell, email, verified_email, created_at, updated_at)
     values ($1, $2, $3, true, $4, $5, $6, $6, $7, $7) on conflict do nothing`,
    [coachId, p.first, p.last, p.pinHash, cell, email, now],
  );
  return r.rowCount ? coachId : null;
}

// A team's other staff (Assistant Coach, Manager, Team Parent), for its card on the Teams page (never public).
export async function teamStaff(q: Pick<Queryable, "query">, teamIds: string[]) {
  const r = await q.query<{ teamId: string; role: StaffRole; first: string; last: string; cell: string; email: string | null }>(
    `select team_id::text as "teamId", role, first_name as first, last_name as last, cell, email from scenic_team_staff
      where team_id = any($1::bigint[]) order by array_position(array['AsstCoach', 'Manager', 'TeamParent'], role)`,
    [teamIds],
  );
  const out: Record<string, typeof r.rows> = {};
  for (const s of r.rows) (out[s.teamId] ??= []).push(s);
  return out;
}

// A returning coach (after their PIN) picks what they came to do instead of a new team: register their CourtSolo team
// (its Register tab), add teams to their organization (its Teams tab), or switch their CourtSolo account to CourtOrg
// (with the organization's name) and bring the team along. The PIN is checked again; then they're logged in.
export type GoTarget =
  { to: "register"; slug: string } | { to: "org"; slug: string } | { to: "switch"; slug: string; name: string; short: string };

export async function teamSignupGo(
  deps: Deps,
  cellInput: unknown,
  pin: unknown,
  target: GoTarget,
): Promise<TeamStep | { step: "loggedIn"; token: string; expiresAt: Date; slug: string; next: string }> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err("Enter your 10-digit cell number.");
  const t = target as Partial<GoTarget>;
  const s = await withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    const user = (await q.query<CoachRow>("select * from users where cell = $1", [cell])).rows[0];
    if (!user?.active) return err("That login isn't active.");
    const bad = await checkPin(deps, q, user, pin);
    if (bad) return bad as TeamStep;
    const acc = await myAccounts(q, user.coach_id, easternDate(deps.now()));
    const ok = t.to === "org" ? acc.orgs.some((o) => o.slug === t.slug) : acc.solo.some((a) => a.slug === t.slug);
    if (!ok || typeof t.slug !== "string") return err("Pick one of your accounts.");
    return startSession(deps, q, user.coach_id);
  });
  if (s.step !== "loggedIn") return s as TeamStep;
  let slug = t.slug as string;
  if (t.to === "switch") {
    const viewer = await getSessionUser(deps, s.token);
    if (!viewer) return err("Couldn't log in.");
    const r = await switchSoloToOrg(deps, viewer, slug, { name: t.name, short: t.short });
    if (!r.ok) return err(r.message);
    slug = r.slug;
  }
  const next = t.to === "register" ? `/org/${slug}?open=register#teams` : `/org/${slug}?open=teams#teams`;
  return { step: "loggedIn", token: s.token, expiresAt: s.expiresAt, slug, next };
}
