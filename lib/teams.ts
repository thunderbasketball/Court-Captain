// Teams: list, view, create and edit, and team staff.
// The Director edits everything; a team's head coach can add and remove its other staff.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanEmail, cleanName } from "./auth/validate";
import { normalizeCell } from "./phone";
import { withTx } from "./sql";
import {
  GRADES,
  LEVELS,
  baseName,
  gradeSort,
  gradesOk,
  placeName,
  settleName,
  tbdBase,
  teamName,
  type NamedTeam,
} from "./team-names";
import { hasArea } from "./org-admin";
import { syncThunderCopy } from "./thunder-leagues";
import { matchOrCreateUser } from "./user-match";

export { GRADES, LEVELS, teamName } from "./team-names";

export const ROLES = ["HeadCoach", "AsstCoach", "Manager", "TeamParent"] as const;
export type Role = (typeof ROLES)[number];
const COACH_ROLES: Role[] = ["HeadCoach", "AsstCoach"];

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

// A problem to show the user; rolls the transaction back.
class UserError extends Error {}

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, message: e.message };
    throw e;
  }
}

const byOf = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

// ---- Reading ----

export type TeamListItem = {
  id: string;
  name: string;
  gender: "Boys" | "Girls";
  grades: string[];
  level: string;
  altName: string | null; // e.g. "Bolts"
  createdBy: string;
  practiceLocations: string[];
  headCoach: { first: string; last: string; cell: string } | null;
  waitingCoach: { first: string; last: string } | null; // named without a cell yet: COACH CELL MUST BE ENTERED
  staff: Contact[]; // Head Coach, Assistant, Manager, Team Parent order
  players: { registrantId: string; first: string; last: string; grade: string; rosteredBy: string }[]; // by last name
};

export type Contact = { coachId: string; role: Role; first: string; last: string; cell: string; email: string | null };

const roleOrder = `array_position(array['HeadCoach','AsstCoach','Manager','TeamParent'], s.role)`;

// Director only. Grouped by level (Comp first), then Gender; youngest grade first, then name.
export async function listTeams(deps: Deps, viewer: SessionUser): Promise<TeamListItem[]> {
  if (!hasArea(viewer, "teams")) throw new Error("Director only");
  const r = await deps.pool.query<Omit<TeamListItem, "headCoach">>(
    `select t.id::text, t.name, t.gender, t.grades, t.level, t.alt_name as "altName", t.created_by as "createdBy", t.practice_locations as "practiceLocations",
            case when t.coach_first is null then null else json_build_object('first', t.coach_first, 'last', t.coach_last) end as "waitingCoach",
            coalesce((select json_agg(json_build_object('coachId', u.coach_id, 'role', s.role, 'first', u.first_name, 'last', u.last_name,
                                                        'cell', u.cell, 'email', u.email) order by ${roleOrder})
                      from team_staff s join users u on u.coach_id = s.coach_id where s.team_id = t.id), '[]') as staff,
            coalesce((select json_agg(json_build_object('registrantId', p.registrant_id, 'first', p.first_name, 'last', p.last_name,
                                                        'grade', p.grade, 'rosteredBy', p.rostered_by)
                                      order by lower(p.last_name), lower(p.first_name))
                      from team_players p where p.team_id = t.id), '[]') as players
     from teams t
     order by t.level = 'COMP' desc, t.gender, t.grade_sort, lower(t.name)`,
  );
  return r.rows.map((t) => {
    const h = t.staff.find((s) => s.role === "HeadCoach");
    return { ...t, grades: sortGrades(t.grades), headCoach: h ? { first: h.first, last: h.last, cell: h.cell } : null };
  });
}

const sortGrades = (g: string[]) => [...g].sort((a, b) => gradeSort(a) - gradeSort(b));

export type StaffMember = {
  coachId: string;
  role: Role;
  firstName: string;
  lastName: string;
  cell: string;
  email: string | null;
  addedBy: string;
};

export type TeamDetail = Omit<TeamListItem, "headCoach" | "staff"> & {
  staff: StaffMember[];
  myRoles: Role[]; // the viewer's own roles on this team
  canEditTeam: boolean;
  canEditStaff: boolean;
};

// The Director, or anyone on this team's staff. Null if the viewer can't see the team.
export async function getTeam(deps: Deps, viewer: SessionUser, id: string): Promise<TeamDetail | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const t = await deps.pool.query<Omit<TeamListItem, "headCoach" | "staff">>(
    `select t.id::text, t.name, t.gender, t.grades, t.level, t.alt_name as "altName", t.created_by as "createdBy", t.practice_locations as "practiceLocations",
            case when t.coach_first is null then null else json_build_object('first', t.coach_first, 'last', t.coach_last) end as "waitingCoach"
     from teams t where t.id = $1`,
    [id],
  );
  if (!t.rows[0]) return null;
  const staff = await deps.pool.query<StaffMember>(
    `select s.coach_id as "coachId", s.role, u.first_name as "firstName", u.last_name as "lastName", u.cell, u.email,
            s.added_by as "addedBy"
     from team_staff s join users u on u.coach_id = s.coach_id
     where s.team_id = $1
     order by ${roleOrder}, lower(u.last_name), lower(u.first_name)`,
    [id],
  );
  // Anyone on the team's staff can view it; the Director sees every team.
  const myRoles = staff.rows.filter((s) => s.coachId === viewer.coachId).map((s) => s.role);
  const isHead = myRoles.includes("HeadCoach");
  if (!hasArea(viewer, "teams") && !myRoles.length) return null;
  return {
    ...t.rows[0],
    grades: sortGrades(t.rows[0].grades),
    staff: staff.rows,
    myRoles,
    canEditTeam: hasArea(viewer, "teams"),
    canEditStaff: hasArea(viewer, "teams") || isHead,
  };
}

export type PersonOption = {
  value: string; // "user:<coachId>" or "volunteer:<registrantId>"
  firstName: string;
  lastName: string;
  detail: string;
  gender?: "Boys" | "Girls";
  grade?: string;
};

// Director only. Active app users, plus registration volunteers who don't have a login yet (matched by cell).
export async function personOptions(
  deps: Deps,
  viewer: SessionUser,
): Promise<{ users: PersonOption[]; volunteers: PersonOption[] }> {
  if (!hasArea(viewer, "teams")) throw new Error("Director only");
  const users = await deps.pool.query<PersonOption>(
    `select 'user:' || coach_id as value, first_name as "firstName", last_name as "lastName",
            case when has_role(coach_id, 'thunder', 'Director') then 'Director' when has_role(coach_id, 'thunder', 'Coach') then 'Coach' else 'User' end as detail
     from users where active order by lower(last_name), lower(first_name)`,
  );
  const volunteers = await deps.pool.query<PersonOption>(
    `select distinct on (r.parent1_cell) 'volunteer:' || r.registrant_id as value,
            trim(r.parent1_first) as "firstName", trim(r.parent1_last) as "lastName",
            r.coaching_interest || ' · parent of ' || r.first_name as detail, r.gender, r.grade
     from registrations r
     where r.coaching_interest is not null and r.parent1_cell ~ '^\\d{10}$'
       and nullif(trim(r.parent1_first), '') is not null and nullif(trim(r.parent1_last), '') is not null
       and not exists (select 1 from users u where u.cell = r.parent1_cell)
     order by r.parent1_cell, r.coaching_interest ilike 'head%' desc, r.grade_sort`,
  );
  const byName = (a: PersonOption, b: PersonOption) =>
    a.lastName.localeCompare(b.lastName, undefined, { sensitivity: "base" }) ||
    a.firstName.localeCompare(b.firstName, undefined, { sensitivity: "base" });
  return { users: users.rows, volunteers: volunteers.rows.sort(byName) };
}

// ---- People ----

// Who to put on a team: an app user, a registration volunteer, or a new person typed in.
// Volunteers and new people get a login (starter PIN 1234). Coach roles also get the Coach flag.
export type PersonInput = unknown;
type NewPerson = { first: unknown; last: unknown; cell: unknown; email: unknown };

async function resolvePerson(
  q: PoolClient,
  person: PersonInput,
  isCoach: boolean,
  now: Date,
): Promise<{ coachId: string; lastName: string; who: string; newLogin: boolean }> {
  let found: { coachId: string; lastName: string; who: string; newLogin: boolean };
  const m = typeof person === "string" ? person.match(/^(user|volunteer):(\d{1,20})$/) : null;

  if (m?.[1] === "user") {
    const u = await q.query<{ coach_id: string; first_name: string; last_name: string }>(
      "select coach_id, first_name, last_name from users where coach_id = $1 and active for update",
      [m[2]],
    );
    if (!u.rows[0]) throw new UserError("That person isn't an active user.");
    const x = u.rows[0];
    found = { coachId: x.coach_id, lastName: x.last_name, who: `${x.first_name} ${x.last_name}`, newLogin: false };
  } else if (m?.[1] === "volunteer") {
    const r = await q.query<{ first: string; last: string; cell: string; email: string | null }>(
      `select trim(parent1_first) as first, trim(parent1_last) as last, parent1_cell as cell, parent1_email as email
       from registrations where registrant_id = $1 and coaching_interest is not null`,
      [m[2]],
    );
    const v = r.rows[0];
    const first = cleanName(v?.first);
    const last = cleanName(v?.last);
    if (!v || !first || !last || !/^\d{10}$/.test(v.cell ?? ""))
      throw new UserError("That volunteer needs a name and a 10-digit cell before they can be added.");
    found = await createOrMatchUser(q, { first, last, cell: v.cell, email: cleanEmail(v.email) }, now);
  } else if (person && typeof person === "object") {
    const p = person as NewPerson;
    const first = cleanName(p.first);
    const last = cleanName(p.last);
    const cell = typeof p.cell === "string" ? normalizeCell(p.cell) : null;
    const emailText = typeof p.email === "string" ? p.email.trim() : "";
    const email = emailText ? cleanEmail(emailText) : null;
    if (!first || !last) throw new UserError("Enter a first and last name (letters only).");
    if (!cell) throw new UserError("Enter a 10-digit cell number.");
    if (emailText && !email) throw new UserError("That email doesn't look right.");
    found = await createOrMatchUser(q, { first, last, cell, email }, now);
  } else {
    throw new UserError("Pick a person.");
  }

  // Head and Assistant Coaches get the Thunder Coach role.
  if (isCoach)
    await q.query("select set_role($1, 'thunder', 'Coach', true, null), set_role($1, 'thunder', 'Request', false, null)", [
      found.coachId,
    ]);
  return found;
}

// Uses the existing user with this cell, or creates one (lib/user-match.ts).
async function createOrMatchUser(
  q: PoolClient,
  p: { first: string; last: string; cell: string; email: string | null },
  now: Date,
) {
  const r = await matchOrCreateUser(q, p, now);
  if ("error" in r) throw new UserError(r.error);
  return r;
}

// ---- Team fields ----

// An optional Alternate name ("Bolts"): letters, numbers and simple punctuation, never a formula. Blank: none.
function cleanAltName(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\d][\p{L}\d .'&#,()/-]{0,59}$/u.test(s))
    throw new UserError("Alternate name: letters, numbers and simple punctuation.");
  return s;
}

// Directors of Teams: change a team's Alternate name (blank removes it).
export async function setTeamAltName(deps: Deps, viewer: SessionUser, id: string, alt: unknown): Promise<Result> {
  if (!hasArea(viewer, "teams")) return { ok: false, message: "Only a Director of Teams can do that." };
  return run(async () => {
    const r = await deps.pool.query("update teams set alt_name = $2 where id = $1", [id, cleanAltName(alt)]);
    if (!r.rowCount) throw new UserError("That team no longer exists.");
    return {};
  });
}

function cleanTeamFields(input: { gender: unknown; grades: unknown; level: unknown }) {
  const gender: "Boys" | "Girls" | null = input.gender === "Boys" || input.gender === "Girls" ? input.gender : null;
  if (!gender) throw new UserError("Pick Boys or Girls.");
  const grades = Array.isArray(input.grades) ? [...new Set(input.grades)] : [];
  if (!grades.length || !grades.every((g) => (GRADES as readonly unknown[]).includes(g)))
    throw new UserError("Pick at least one grade.");
  const level = (LEVELS as readonly unknown[]).includes(input.level) ? (input.level as string) : null;
  if (!level) throw new UserError("Pick REC or COMP.");
  return { gender, grades: grades as string[], level, gradeSort: Math.max(...(grades as string[]).map(gradeSort)) };
}

// Gym names: start with a letter or digit, then letters, digits, spaces and . ' & -.
function cleanLocations(v: unknown): string[] {
  const list = typeof v === "string" ? v.split(",") : Array.isArray(v) ? v : [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const s = raw.trim().replace(/\s+/g, " ");
    if (!s) continue;
    if (!/^[\p{L}\d][\p{L}\d .'&-]{0,59}$/u.test(s)) throw new UserError(`"${s}" isn't a valid gym name.`);
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  if (out.length > 20) throw new UserError("That's too many practice locations.");
  return out;
}

// A Thunder team's name from `base` (the rule's name): numbered, with any team already named it, when taken (SPEC.md
// section 14). Inside the caller's transaction; `exceptId`: the team being renamed.
export async function thunderTeamName(q: Pick<PoolClient, "query">, base: string, exceptId: string | null): Promise<string> {
  await q.query("select pg_advisory_xact_lock(hashtext('org-teams:thunder'))");
  const teams = (await q.query<NamedTeam>("select id::text, name from teams where ($1::bigint is null or id <> $1)", [exceptId]))
    .rows;
  const { name, renames } = placeName(teams, base);
  for (const r of renames) {
    await q.query("update teams set name = $2 where id = $1", [r.id, r.name]);
    await syncThunderCopy(q, r.id);
  }
  return name;
}

// After a team leaves a name: the one left with it drops its number.
export async function settleThunderName(q: Pick<PoolClient, "query">, base: string) {
  await q.query("select pg_advisory_xact_lock(hashtext('org-teams:thunder'))");
  const teams = (await q.query<NamedTeam>("select id::text, name from teams")).rows;
  const s = settleName(teams, base);
  if (!s) return;
  await q.query("update teams set name = $2 where id = $1", [s.id, s.name]);
  await syncThunderCopy(q, s.id);
}

// Re-applies the naming rule after a change: the Head Coach's last name, else the coach waiting for a cell's, else the
// current one is kept.
async function rename(q: PoolClient, teamId: string): Promise<string> {
  const t = await q.query<{
    name: string;
    gender: "Boys" | "Girls";
    grades: string[];
    head_last: string | null;
    coach_last: string | null;
  }>(
    `select t.name, t.gender, t.grades, u.last_name as head_last, t.coach_last
     from teams t
     left join team_staff s on s.team_id = t.id and s.role = 'HeadCoach'
     left join users u on u.coach_id = s.coach_id
     where t.id = $1`,
    [teamId],
  );
  const r = t.rows[0];
  const base = teamName(r.gender, r.grades, r.head_last ?? r.coach_last ?? (baseName(r.name).replace(/^\S+\s*/, "") || "Team"));
  await syncThunderCopy(q, teamId); // its copy in a league follows (Head Coach now; the name below)
  // Same name by the rule (numbered or not): kept.
  if (r.name.toLowerCase() === base.toLowerCase() || baseName(r.name).toLowerCase() === base.toLowerCase()) return r.name;
  const name = await thunderTeamName(q, base, teamId);
  await q.query("update teams set name = $2 where id = $1", [teamId, name]);
  await syncThunderCopy(q, teamId);
  await settleThunderName(q, baseName(r.name));
  return name;
}

// headCoach: "user:<id>", "volunteer:<registrant>", a new person { first, last, cell, email }, or "none" ("4G TBD" until
// one is added). altName: optional ("Bolts"). Grades: one, or two next to each other (what leagues place by).
export type CreateTeamInput = { gender: unknown; grades: unknown; level: unknown; headCoach: unknown; altName?: unknown };
export type CreateTeamResult = Result<{ id: string; name: string }>;

export async function createTeam(deps: Deps, viewer: SessionUser, input: CreateTeamInput): Promise<CreateTeamResult> {
  if (!hasArea(viewer, "teams")) return { ok: false, message: "Only a Director of Teams can create teams." };
  const now = deps.now();
  const by = byOf(viewer);
  return run(async () => {
    const f = cleanTeamFields(input);
    if (!gradesOk(f.grades)) throw new UserError("Pick one grade, or two next to each other.");
    const none = input.headCoach === "none";
    if (!none && !input.headCoach) throw new UserError("Pick a head coach (or No coach yet).");
    const alt = cleanAltName(input.altName);
    return withTx(deps.pool, async (q) => {
      await q.query("select pg_advisory_xact_lock(hashtext('org-teams:thunder'))");
      const head = none ? null : await resolvePerson(q, input.headCoach, true, now);
      const name = await thunderTeamName(
        q,
        head ? teamName(f.gender, f.grades, head.lastName) : tbdBase(f.gender, f.grades),
        null,
      );
      const t = await q.query<{ id: string }>(
        `insert into teams (name, gender, grades, grade_sort, level, created_at, created_by, alt_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (name) do nothing returning id::text`,
        [name, f.gender, f.grades, f.gradeSort, f.level, now, by, alt],
      );
      if (!t.rows[0]) throw new UserError(`There's already a team named "${name}".`);
      if (head)
        await q.query(
          "insert into team_staff (team_id, coach_id, role, added_at, added_by) values ($1, $2, 'HeadCoach', $3, $4)",
          [t.rows[0].id, head.coachId, now, by],
        );
      return { id: t.rows[0].id, name };
    });
  });
}

export type UpdateTeamInput = { gender: unknown; grades: unknown; level: unknown; practiceLocations: unknown; altName?: unknown };

// Director only. The name follows the new grades/gender.
export async function updateTeam(
  deps: Deps,
  viewer: SessionUser,
  id: string,
  input: UpdateTeamInput,
): Promise<Result<{ name: string }>> {
  if (!hasArea(viewer, "teams")) return { ok: false, message: "Only a Director of Teams can edit a team." };
  return run(async () => {
    const f = cleanTeamFields(input);
    const locations = cleanLocations(input.practiceLocations);
    return withTx(deps.pool, async (q) => {
      const r = await q.query(
        `update teams set gender = $2, grades = $3, grade_sort = $4, level = $5, practice_locations = $6,
                alt_name = case when $8 then $7 else alt_name end where id = $1`,
        [id, f.gender, f.grades, f.gradeSort, f.level, locations, cleanAltName(input.altName), input.altName !== undefined],
      );
      if (!r.rowCount) throw new UserError("That team no longer exists.");
      return { name: await rename(q, id) };
    });
  });
}

// Directors of Teams: delete a team. Its staff, roster, evaluations, uniforms and practice attendance go with it;
// its booked practice times (past and future) open up again.
export async function deleteTeam(deps: Deps, viewer: SessionUser, id: string): Promise<Result> {
  if (!hasArea(viewer, "teams")) return { ok: false, message: "Only a Director of Teams can delete a team." };
  if (!/^\d{1,18}$/.test(id)) return { ok: false, message: "That team no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const t = await q.query<{ name: string }>("select name from teams where id = $1 for update", [id]);
      if (!t.rows[0]) throw new UserError("That team no longer exists.");
      await q.query("update slots set team_id = null, booked_by = null, booked_at = null where team_id = $1", [id]);
      await q.query("delete from teams where id = $1", [id]);
      await settleThunderName(q, baseName(t.rows[0].name));
      return {};
    }),
  );
}

// ---- Staff ----

async function lockTeamForStaff(q: PoolClient, viewer: SessionUser, teamId: string, role: Role) {
  const t = await q.query("select 1 from teams where id = $1 for update", [teamId]);
  if (!t.rows[0]) throw new UserError("That team no longer exists.");
  if (hasArea(viewer, "teams")) return;
  // A head coach can manage their own team's other staff, but not the head coach spot.
  const head = await q.query("select 1 from team_staff where team_id = $1 and role = 'HeadCoach' and coach_id = $2", [
    teamId,
    viewer.coachId,
  ]);
  if (!head.rows[0]) throw new UserError("Only a Director of Teams or this team's head coach can change staff.");
  if (role === "HeadCoach") throw new UserError("Only a Director of Teams can change the head coach.");
}

export type AddStaffResult = Result<{ who: string; newLogin: boolean; name: string }>;

// One person per role. Adding a head coach replaces the current one and renames the team.
export async function addStaff(
  deps: Deps,
  viewer: SessionUser,
  teamId: string,
  input: { role: unknown; person: unknown },
): Promise<AddStaffResult> {
  const role = (ROLES as readonly unknown[]).includes(input.role) ? (input.role as Role) : null;
  if (!role) return { ok: false, message: "Pick a role." };
  if (!/^\d{1,18}$/.test(teamId)) return { ok: false, message: "That team no longer exists." };
  const now = deps.now();
  const by = byOf(viewer);
  return run(() =>
    withTx(deps.pool, async (q) => {
      await lockTeamForStaff(q, viewer, teamId, role);
      // One person per role. A new head coach replaces the old one; other roles must be removed first.
      if (role !== "HeadCoach") {
        const held = await q.query<{ who: string }>(
          `select u.first_name || ' ' || u.last_name as who from team_staff s join users u on u.coach_id = s.coach_id
           where s.team_id = $1 and s.role = $2`,
          [teamId, role],
        );
        if (held.rows[0])
          throw new UserError(`This team already has a ${roleLabel(role)} (${held.rows[0].who}). Remove them first.`);
      }
      const p = await resolvePerson(q, input.person, COACH_ROLES.includes(role), now);
      if (role === "HeadCoach") {
        await q.query("delete from team_staff where team_id = $1 and role = 'HeadCoach'", [teamId]);
        // A coach waiting for a cell is replaced by the real one.
        await q.query("update teams set coach_first = null, coach_last = null where id = $1", [teamId]);
      }
      const r = await q.query(
        "insert into team_staff (team_id, coach_id, role, added_at, added_by) values ($1, $2, $3, $4, $5) on conflict do nothing",
        [teamId, p.coachId, role, now, by],
      );
      if (!r.rowCount) throw new UserError(`${p.who} is already ${roleLabel(role)} on this team.`);
      return { who: p.who, newLogin: p.newLogin, name: role === "HeadCoach" ? await rename(q, teamId) : "" };
    }),
  );
}

// ---- A Head Coach named without a cell yet ----

// Directors of Teams: fix the waiting coach's name, or remove them (null: the team is "TBD" again). Only while the team
// has no Head Coach; adding their cell (addStaff, Head Coach, a new person) makes them the Head Coach.
export async function setWaitingCoach(
  deps: Deps,
  viewer: SessionUser,
  teamId: string,
  input: { first: unknown; last: unknown } | null,
): Promise<Result<{ name: string }>> {
  if (!hasArea(viewer, "teams")) return { ok: false, message: "Only a Director of Teams can change the Head Coach." };
  if (!/^\d{1,18}$/.test(teamId)) return { ok: false, message: "That team no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const first = input ? cleanName(input.first) : null;
      const last = input ? cleanName(input.last) : null;
      if (input && (!first || !last)) throw new UserError("Enter the coach's first and last name (letters only).");
      const t = await q.query("select 1 from teams where id = $1 for update", [teamId]);
      if (!t.rows[0]) throw new UserError("That team no longer exists.");
      const head = await q.query("select 1 from team_staff where team_id = $1 and role = 'HeadCoach'", [teamId]);
      if (head.rows[0]) throw new UserError("This team already has a Head Coach.");
      await q.query("update teams set coach_first = $2, coach_last = $3 where id = $1", [teamId, first, last]);
      // Removed: named "TBD" again.
      return { name: input ? await rename(q, teamId) : await renameTbd(q, teamId) };
    }),
  );
}

// The team back to "4G TBD" (numbered when taken).
async function renameTbd(q: PoolClient, teamId: string): Promise<string> {
  const t = await q.query<{ name: string; gender: "Boys" | "Girls"; grades: string[] }>(
    "select name, gender, grades from teams where id = $1",
    [teamId],
  );
  const r = t.rows[0];
  const base = tbdBase(r.gender, r.grades);
  if (baseName(r.name).toLowerCase() === base.toLowerCase()) return r.name;
  const name = await thunderTeamName(q, base, teamId);
  await q.query("update teams set name = $2 where id = $1", [teamId, name]);
  await syncThunderCopy(q, teamId);
  await settleThunderName(q, baseName(r.name));
  return name;
}

// Directors of Teams: the Head Coach's email when they have none yet (they confirm it with a code at their next login).
export async function setHeadCoachEmail(deps: Deps, viewer: SessionUser, teamId: string, email: unknown): Promise<Result> {
  if (!hasArea(viewer, "teams")) return { ok: false, message: "Only a Director of Teams can do that." };
  if (!/^\d{1,18}$/.test(teamId)) return { ok: false, message: "That team no longer exists." };
  const e = cleanEmail(email);
  if (!e) return { ok: false, message: "Enter a real email address." };
  const r = await deps.pool.query(
    `update users u set email = $2, updated_at = $3, updated_by = $4
     from team_staff s where s.team_id = $1 and s.role = 'HeadCoach' and s.coach_id = u.coach_id and u.email is null`,
    [teamId, e, deps.now(), byOf(viewer)],
  );
  if (!r.rowCount) return { ok: false, message: "This team's Head Coach already has an email." };
  return { ok: true };
}

export async function removeStaff(
  deps: Deps,
  viewer: SessionUser,
  teamId: string,
  input: { coachId: unknown; role: unknown },
): Promise<Result> {
  const role = (ROLES as readonly unknown[]).includes(input.role) ? (input.role as Role) : null;
  if (!role || typeof input.coachId !== "string" || !/^\d{7}$/.test(input.coachId))
    return { ok: false, message: "Pick a staff member." };
  if (!/^\d{1,18}$/.test(teamId)) return { ok: false, message: "That team no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      await lockTeamForStaff(q, viewer, teamId, role);
      await q.query("delete from team_staff where team_id = $1 and coach_id = $2 and role = $3", [teamId, input.coachId, role]);
      return {};
    }),
  );
}

export function roleLabel(role: Role): string {
  return { HeadCoach: "Head Coach", AsstCoach: "Assistant Coach", Manager: "Manager", TeamParent: "Team Parent" }[role];
}
