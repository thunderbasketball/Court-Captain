// Register a team (SPEC.md section 13): an outside coach, from Scenic City's login page while it has Team Registrations
// on, picks a program open for registration, enters the team (name, gender, grade), its Head Coach (name, cell, email:
// required) and optionally an Assistant Coach, Manager and Team Parent (name and cell, email optional), and for a League
// what it registers for (ALL Season or Game Days, with the fees). No Level is asked: the team is COMP, or REC where the
// program has no COMP group for its grade. The Head Coach verifies their email with a code: a new cell chooses a PIN
// (their login); a cell that already has a login enters its PIN instead. Then the team is made, owned and coached by the
// Head Coach (the Scenic City Solo role: their own teams), registered in the program, and they're logged in. Team names
// are unique in Scenic City (any capitals). Nothing is saved unless all of it goes in.
import type { PoolClient } from "pg";
import {
  checkCode,
  checkPin,
  issueCode,
  lockCell,
  newPinError,
  startSession,
  type Deps,
  type Step,
  type UserRow,
} from "./auth/service";
import { hashPin } from "./auth/crypto";
import { cleanEmail, cleanName, maskEmail } from "./auth/validate";
import { coachIdFromCell, normalizeCell } from "./phone";
import { planChoice, type Choice, type ProgramOption } from "./program-options";
import { leagueEntry, parseChoice, saveChoice } from "./scenic-programs";
import { cleanTeam, TeamError } from "./scenic-teams";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

const ORG = "scenic-city";
export const STAFF_ROLES = [
  { key: "AsstCoach", label: "Assistant Coach" },
  { key: "Manager", label: "Manager" },
  { key: "TeamParent", label: "Team Parent" },
] as const;
type StaffRole = (typeof STAFF_ROLES)[number]["key"];
type Staff = { role: StaffRole; first: string; last: string; cell: string; email: string | null };

export type TeamSignupInput = {
  programId: unknown;
  choice?: unknown; // a League: { allSeason, days: [{ date, kind }] }
  name: unknown;
  gender: unknown;
  grade: unknown;
  first: unknown;
  last: unknown;
  cell: unknown;
  email: unknown;
  pin?: unknown; // a cell with a login: its PIN
  pin1?: unknown; // a new cell: the PIN they choose
  pin2?: unknown;
  staff?: unknown; // [{ role, first, last, cell, email }]
};

export type TeamStep =
  { step: "form"; existing: boolean } | { step: "code"; maskedEmail: string } | Exclude<Step, { step: "loggedIn" }>;

const err = (message: string): TeamStep => ({ step: "error", message });

export type OpenProgram = {
  id: string;
  name: string;
  kind: string;
  league: { options: ProgramOption[]; gameDates: string[] } | null; // a League's options and Game Days
};

// Programs open for registration today, by start date.
export async function openPrograms(q: Pick<Queryable, "query">, now: Date): Promise<OpenProgram[]> {
  const r = await q.query<{ id: string; name: string; kind: string }>(
    `select id::text, name, kind from scenic_programs
      where reg_opens <= $1::date and reg_closes >= $1::date order by starts_on, lower(name), id`,
    [easternDate(now)],
  );
  return Promise.all(
    r.rows.map(async (p) => {
      if (p.kind !== "League") return { ...p, league: null };
      const { options, gameDates } = await leagueEntry(q, p.id, null);
      return { ...p, league: { options, gameDates } };
    }),
  );
}

// The team's level in this program: COMP, or REC where there's no COMP group for its gender and grade.
async function levelIn(q: Pick<Queryable, "query">, programId: string, gender: string, grade: number) {
  const r = await q.query<{ level: string }>(
    `select g.level from scenic_divisions d join scenic_grade_groups g on g.division_id = d.id
      where d.program_id = $1 and d.gender = $2 and g.grade = $3`,
    [programId, gender, grade],
  );
  const levels = r.rows.map((x) => x.level);
  return levels.includes("COMP") ? "COMP" : levels.includes("REC") ? "REC" : null;
}

// Something that stops the whole registration (nothing kept).
class Stop extends Error {}

const nameTaken = async (q: Pick<Queryable, "query">, name: string) =>
  !!(await q.query("select 1 from scenic_teams where lower(name) = lower($1)", [name])).rowCount;

// Step 1: the Head Coach's cell. Does it have a login already (then they enter its PIN, not a new one)?
export async function teamSignupLookup(deps: Deps, cellInput: unknown): Promise<TeamStep> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err("Enter the Head Coach's 10-digit cell number.");
  if (!(await openPrograms(deps.pool, deps.now())).length) return err("Team registration isn't open right now.");
  const u = await deps.pool.query<{ active: boolean }>("select active from users where cell = $1", [cell]);
  if (u.rows[0] && !u.rows[0].active) return err("That cell's account is deactivated. Please contact Scenic City.");
  return { step: "form", existing: !!u.rows[0] };
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

// Step 2: check everything, then email the Head Coach a code. Nothing is saved until the code checks out.
export async function teamSignupStart(deps: Deps, input: TeamSignupInput): Promise<TeamStep> {
  let f: ReturnType<typeof cleanTeam>;
  try {
    f = cleanTeam({
      name: input.name,
      gender: input.gender,
      level: "REC", // not asked: set from the program below
      grade: input.grade,
      coachFirst: input.first,
      coachLast: input.last,
      coachCell: input.cell,
    });
  } catch (e) {
    if (e instanceof TeamError) return err(e.message.replace("the coach's", "the Head Coach's"));
    throw e;
  }
  const email = cleanEmail(input.email);
  if (!email) return err("Enter the Head Coach's email.");
  const staff = cleanStaff(input.staff);
  if (typeof staff === "string") return err(staff);
  const program = (await openPrograms(deps.pool, deps.now())).find((x) => x.id === input.programId);
  if (!program) return err("Pick a program open for registration.");
  const level = await levelIn(deps.pool, program.id, f.gender, f.grade.grade);
  if (!level) return err(`${program.name} has no group for ${f.gender} in this grade.`);
  let choice: Choice | null = null;
  if (program.league) {
    choice = parseChoice(input.choice);
    if (!choice || (!choice.allSeason && !choice.days.length)) return err("Pick ALL Season or at least one date.");
    const today = easternDate(deps.now());
    if (choice.days.some((d) => d.date < today)) return err("Past Game Days can't be picked.");
    const plan = planChoice(program.league.options, program.league.gameDates, { allSeason: false, days: [] }, choice);
    if ("error" in plan) return err(plan.error);
  }
  return withTx(deps.pool, async (q) => {
    await lockCell(q, f.cell);
    const u = await q.query<Pick<UserRow, "coach_id" | "active" | "pin_hash" | "cell">>(
      "select coach_id, active, pin_hash, cell from users where cell = $1",
      [f.cell],
    );
    const user = u.rows[0];
    let pinHash: string | null = null;
    if (user) {
      if (!user.active) return err("That cell's account is deactivated. Please contact Scenic City.");
      const bad = await checkPin(deps, q, user as UserRow, input.pin);
      if (bad) return bad as TeamStep; // a wrong PIN or a lockout
    } else {
      const clash = await q.query("select 1 from users where coach_id = $1", [coachIdFromCell(f.cell)]);
      if (clash.rowCount) return err("That number is already in use. Please contact Scenic City.");
      const pinError = newPinError(input.pin1, input.pin2);
      if (pinError) return err(pinError);
      pinHash = await hashPin(input.pin1 as string);
    }
    if (await nameTaken(q, f.name)) return err(`There's already a team named ${f.name}. Pick another name.`);
    const team = { name: f.name, gender: f.gender, level, low: f.grade.low, grade: f.grade.grade };
    const fail = await issueCode(deps, q, f.cell, "team", email, {
      programId: program.id,
      choice,
      team,
      staff,
      first: f.first,
      last: f.last,
      pinHash,
      existing: !!user,
    });
    return (fail as TeamStep | null) ?? { step: "code", maskedEmail: maskEmail(email) };
  });
}

type Payload = {
  programId: string;
  choice: Choice | null;
  team: { name: string; gender: string; level: string; low: number; grade: number };
  staff: Staff[];
  first: string;
  last: string;
  pinHash: string | null;
  existing: boolean;
};

// Step 3: the code. Makes the login (or confirms the email of the one there), the team and its staff; logs them in.
export async function teamSignupComplete(
  deps: Deps,
  cellInput: unknown,
  code: unknown,
): Promise<TeamStep | { step: "loggedIn"; token: string; expiresAt: Date; teamId: string; programId: string }> {
  const cell = typeof cellInput === "string" ? normalizeCell(cellInput) : null;
  if (!cell) return err("Enter the Head Coach's 10-digit cell number.");
  // The code is checked (and a wrong try counted) on its own; the rest goes in all at once or not at all.
  const c = await withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    return checkCode(deps, q, cell, "team", code);
  });
  if (!c.ok) return c.step as TeamStep; // a wrong or expired code
  const p = c.row.payload as unknown as Payload;
  try {
    return await withTx(deps.pool, (q) => registerAll(deps, q, cell, p, c.row.email));
  } catch (e) {
    if (e instanceof Stop) return err(`${e.message} Start again.`);
    throw e;
  }
}

async function registerAll(deps: Deps, q: PoolClient, cell: string, p: Payload, email: string) {
  const now = deps.now();
  await lockCell(q, cell);
  // One name at a time across Scenic City.
  await q.query("select pg_advisory_xact_lock(hashtext('scenic-team-names'))");
  if (await nameTaken(q, p.team.name)) throw new Stop(`There's already a team named ${p.team.name}.`);
  const open = await q.query(
    "select 1 from scenic_programs where id = $1 and reg_opens <= $2::date and reg_closes >= $2::date for share",
    [p.programId, easternDate(now)],
  );
  if (!open.rowCount) throw new Stop("Registration for that program has closed.");
  const coachId = await headCoach(q, cell, p, email, now);
  if (!coachId) throw new Stop("That number is already in use. Please contact Scenic City.");
  const who = `${p.first} ${p.last}`;
  await q.query(
    "select set_role($1, $2, 'Solo', true, $3), set_role($1, $2, 'Coach', true, $3), set_role($1, $2, 'Request', false, $3)",
    [coachId, ORG, "Team registration"],
  );
  const t = await q.query<{ id: string }>(
    `insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, created_at, updated_by, updated_at)
       values ($1, $2, $3, $4, $5, $6, $6, $7, $8, $7, $8) returning id::text`,
    [p.team.name, p.team.gender, p.team.low, p.team.grade, p.team.level, coachId, who, now],
  );
  const teamId = t.rows[0].id;
  for (const s of p.staff)
    await q.query(
      `insert into scenic_team_staff (team_id, role, first_name, last_name, cell, email, added_by, added_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [teamId, s.role, s.first, s.last, s.cell, s.email, who, now],
    );
  const reg = await saveChoice(q, p.programId, teamId, p.choice ?? undefined, who, now);
  if ("error" in reg) throw new Stop(reg.error);
  const s = await startSession(deps, q, coachId);
  if (s.step !== "loggedIn") throw new Stop("Couldn't log in.");
  return { ...s, teamId, programId: p.programId };
}

// The Head Coach's login: a new one with their PIN and verified email, or the one there with this email now verified.
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
