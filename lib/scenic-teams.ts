// Scenic City teams (SPEC.md section 13, build step 6: Team Registrations). Kept apart from Thunder's teams.
// A partner's contacts make its teams; a Solo coach makes their own. Directors of Teams (and Admins) see and edit all.
// Each team names a coach by cell: that cell is their login (made if new), and they get the Scenic City Coach role.
import { easternDate } from "./time";
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanEmail, cleanName } from "./auth/validate";
import { orgHasArea } from "./org-admin";
import type { ScenicRole } from "./orgs";
import { normalizeCell } from "./phone";
import { cleanPlaceName } from "./scenic-partners";
import { withTx, type Queryable } from "./sql";
import { matchOrCreateUser } from "./user-match";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
export class TeamError extends Error {}

const ORG = "scenic-city";
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

// Every Scenic City team is COMP (competitive) or REC (recreational); divisions are by level too.
export const LEVELS = ["COMP", "REC"] as const;
export type Level = (typeof LEVELS)[number];

// ---- Grades: one grade, or two in a row (3rd/4th), listed and played with the higher grade ----

const ordinal = (g: number) =>
  g === -1 ? "Pre-K" : g === 0 ? "K" : g === 1 ? "1st" : g === 2 ? "2nd" : g === 3 ? "3rd" : `${g}th`;

export function gradeLabel(low: number, grade: number): string {
  return low === grade ? ordinal(grade) : `${ordinal(low)}/${ordinal(grade)}`;
}

// A division's grades: "5th" or "3rd–4th".
export function gradeRange(low: number, high: number): string {
  return low === high ? ordinal(high) : `${ordinal(low)}–${ordinal(high)}`;
}

// The choices, youngest first: Pre-K (Coed only), K, K/1st, 1st, 1st/2nd, … 12th. Value "PK", "3" or "3-4".
export const GRADE_CHOICES: { value: string; label: string }[] = [
  { value: "PK", label: "Pre-K (Coed)" },
  ...Array.from({ length: 13 }, (_, g) => [
    { value: String(g), label: ordinal(g) },
    ...(g < 12 ? [{ value: `${g}-${g + 1}`, label: gradeLabel(g, g + 1) }] : []),
  ]).flat(),
];

export function parseGrade(v: unknown): { low: number; grade: number } | null {
  if (typeof v !== "string") return null;
  if (v === "-1" || v === "PK") return { low: -1, grade: -1 }; // Pre-K (organizations' League teams)
  const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(v);
  if (!m) return null;
  const low = Number(m[1]);
  const grade = m[2] === undefined ? low : Number(m[2]);
  return low >= 0 && grade <= 12 && (grade === low || grade === low + 1) ? { low, grade } : null;
}

// ---- Who can do what ----

const isTeamsDirector = (q: Queryable, viewer: SessionUser) => orgHasArea(q, viewer.coachId, ORG, "teams");

async function isContactOf(q: Queryable, viewer: SessionUser, partnerId: string): Promise<boolean> {
  const r = await q.query<{ ok: boolean }>(
    `select has_role($1, 'scenic-city', 'Partner') and exists (select 1 from partner_contacts where partner_id = $2 and coach_id = $1) as ok`,
    [viewer.coachId, partnerId],
  );
  return r.rows[0].ok;
}

const hasRole = async (q: Queryable, coachId: string, role: ScenicRole) =>
  (await q.query<{ ok: boolean }>("select acts_as($1, 'scenic-city', $2) as ok", [coachId, role])).rows[0].ok;

// May this person change this team? A Director of Teams, a contact of its partner, or its Solo owner.
async function canEdit(q: Queryable, viewer: SessionUser, t: { partner_id: string | null; owner_coach_id: string | null }) {
  if (await isTeamsDirector(q, viewer)) return true;
  if (t.partner_id) return isContactOf(q, viewer, t.partner_id);
  return t.owner_coach_id === viewer.coachId && (await hasRole(q, viewer.coachId, "Solo"));
}

// ---- Listing ----

export type ScenicTeam = {
  id: string;
  name: string;
  gender: "Boys" | "Girls" | "Coed";
  level: Level;
  gradeLow: number;
  grade: number;
  gradeLabel: string;
  partnerId: string | null;
  partnerName: string | null; // its organization (a club, or an organization on CourtCaptain)
  ownerName: string | null; // Solo teams
  altName: string | null; // e.g. "Bolts"
  divisionLow: number | null; // the division it plays in (its latest program); none yet: null
  divisionHigh: number | null;
  coachId: string | null; // an organization's team may have no Head Coach yet
  coachFirst: string | null; // the Head Coach, or one named without a cell yet (imported: coachId and coachCell null)
  coachLast: string | null;
  coachCell: string | null;
  coachEmail: string | null;
  waitingCoach: boolean; // named without a cell yet: COACH CELL MUST BE ENTERED
  createdBy: string;
  updatedBy: string;
  canEdit: boolean;
};

// Who a new team can be for: a partner (its contacts, or a Director of Teams) or "solo" (a Solo coach's own).
export type TeamOwnerChoice = { value: string; label: string };

// A program to pick on the Teams page: current and upcoming first (soonest first), then past ones (latest first).
export type TeamsProgram = { id: string; name: string; ended: boolean };

// The teams this role sees (the chip in use; only narrows what the server allows), sorted Boys then Girls, by grade, level
// (COMP first), then name. Partner: their partners' teams. Solo: their own. Coach: the teams they coach. Director (of
// Teams): every team. A team is in Scenic City for a program: `program` picks one (past ones too, to look back), and
// lists the teams registered in it with that program's division. "none": Scenic City's own teams (outside clubs' and
// CourtSolo) not in any program that hasn't ended, to register them again or delete them. No `program`: every team
// registered in a program that hasn't ended. An organization's team (CourtOrg or Thunder) is never "none": it stays
// with its organization.
export async function listScenicTeams(
  deps: Deps,
  viewer: SessionUser,
  as: ScenicRole,
  program?: string,
): Promise<{ teams: ScenicTeam[]; addFor: TeamOwnerChoice[]; programs: TeamsProgram[] } | null> {
  const q = deps.pool;
  if (!(await hasRole(q, viewer.coachId, as))) return null;
  if (as === "Director" && !(await isTeamsDirector(q, viewer))) return null;
  const params: unknown[] = as === "Director" ? [] : [viewer.coachId];
  const arg = (v: unknown) => `$${params.push(v)}`;
  const where = as === "Director" ? "true" : as === "Solo" ? "t.owner_coach_id = $1" : "t.coach_id = $1";
  const picked = program && /^\d{1,18}$/.test(program) ? arg(program) : null;
  const current = () => `exists (select 1 from scenic_registrations r join scenic_programs pr on pr.id = r.program_id
                            where r.team_id = t.id and pr.ends_on >= ${arg(easternDate(deps.now()))}::date)`;
  const which = picked
    ? `exists (select 1 from scenic_registrations r where r.team_id = t.id and r.program_id = ${picked}::bigint)`
    : program === "none"
      ? `t.org_team_id is null and t.thunder_team_id is null and not ${current()}`
      : current();
  const r = await q.query<Omit<ScenicTeam, "gradeLabel" | "canEdit"> & { owner_coach_id: string | null; org_team: boolean }>(
    `select t.id::text, t.name, t.gender, t.level, t.grade_low as "gradeLow", t.grade, t.partner_id::text as "partnerId", p.name as "partnerName",
            o.first_name || ' ' || o.last_name as "ownerName", t.owner_coach_id,
            t.coach_id as "coachId", coalesce(c.first_name, t.coach_first) as "coachFirst", coalesce(c.last_name, t.coach_last) as "coachLast",
            c.cell as "coachCell", c.email as "coachEmail", (t.coach_id is null and t.coach_first is not null) as "waitingCoach",
            t.created_by as "createdBy", t.updated_by as "updatedBy", (t.org_team_id is not null or t.thunder_team_id is not null) as org_team,
            coalesce(t.alt_name, ot.alt_name, th.alt_name) as "altName", dv.grade_low as "divisionLow", dv.grade_high as "divisionHigh"
     from scenic_teams t
     left join org_teams ot on ot.id = t.org_team_id
     left join teams th on th.id = t.thunder_team_id
     left join lateral (
       select d.grade_low, d.grade_high from scenic_registrations r
       join scenic_pools sp on sp.id = r.pool_id join scenic_grade_groups g on g.id = sp.group_id
       join scenic_divisions d on d.id = g.division_id join scenic_programs pr on pr.id = r.program_id
       where r.team_id = t.id ${picked ? `and r.program_id = ${picked}::bigint` : ""} order by pr.starts_on desc limit 1) dv on true
     left join users c on c.coach_id = t.coach_id
     left join partners p on p.id = t.partner_id
     left join users o on o.coach_id = t.owner_coach_id
     where (${where}) and ${which}
     order by t.gender, t.grade, t.level, lower(t.name)`,
    params,
  );
  const director = as === "Director";
  const teams: ScenicTeam[] = r.rows.map(({ owner_coach_id, org_team, ...t }) => ({
    ...t,
    gradeLabel: gradeLabel(t.gradeLow, t.grade),
    // A registered organization's team is managed there (read-only here).
    canEdit: !org_team && (director || (as === "Solo" && owner_coach_id === viewer.coachId)),
  }));
  let addFor: TeamOwnerChoice[] = [];
  if (as === "Director") {
    const p = await q.query<{ id: string; name: string }>(
      "select id::text, name from partners where approved and registers_teams and org_slug is null order by lower(name)",
    );
    addFor = p.rows.map((x) => ({ value: x.id, label: x.name }));
  } else if (as === "Solo") addFor = [{ value: "solo", label: "My teams (Solo)" }];
  const programs = (
    await q.query<TeamsProgram>(
      `select id::text, name, ends_on < $1::date as ended from scenic_programs
        order by ends_on < $1::date, case when ends_on >= $1::date then starts_on end, starts_on desc, lower(name)`,
      [easternDate(deps.now())],
    )
  ).rows;
  return { teams, addFor, programs };
}

// ---- Changes ----

export type TeamInput = {
  for?: unknown; // a partner id, or "solo" (new teams only)
  name: unknown;
  gender: unknown;
  level: unknown; // "COMP" or "REC"
  grade: unknown; // "3" or "3-4"
  coachFirst: unknown;
  coachLast: unknown;
  coachCell: unknown;
};

export function cleanTeam(input: TeamInput) {
  // Team names: letters, numbers, spaces and . ' & - , ( ) # /, starting with a letter or number (never a formula).
  const name = cleanPlaceName(input.name);
  if (!name) throw new TeamError("Enter a team name: letters, numbers and simple punctuation, up to 60 characters.");
  const gender = input.gender === "Boys" || input.gender === "Girls" || input.gender === "Coed" ? input.gender : null;
  if (!gender) throw new TeamError("Pick Boys, Girls or Coed.");
  const level = LEVELS.find((l) => l === input.level);
  if (!level) throw new TeamError("Pick COMP or REC.");
  const grade = parseGrade(input.grade);
  if (!grade) throw new TeamError("Pick a grade.");
  // Pre-K (ages 3 and 4) teams are Coed and REC; Coed teams are Pre-K.
  if (grade.grade === -1 && gender !== "Coed") throw new TeamError("Pre-K teams are Coed.");
  if (grade.grade !== -1 && gender === "Coed") throw new TeamError("Only Pre-K teams are Coed; pick Boys or Girls.");
  if (grade.grade === -1 && level !== "REC") throw new TeamError("Pre-K teams are REC.");
  const first = cleanName(input.coachFirst);
  const last = cleanName(input.coachLast);
  if (!first || !last) throw new TeamError("Enter the coach's first and last name (letters only).");
  const cell = typeof input.coachCell === "string" ? normalizeCell(input.coachCell) : null;
  if (!cell) throw new TeamError("Enter the coach's 10-digit cell number.");
  return { name, gender, level, grade, first, last, cell };
}

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof TeamError) return { ok: false, message: e.message };
    if ((e as { code?: string }).code === "23505") return { ok: false, message: "There's already a team with that name here." };
    throw e;
  }
}

// A coach with no Scenic City team of its own left (outside clubs', CourtSolo; an organization's teams don't count, their
// coaches have the Coach role there) loses the Scenic City Coach role. Run after a team is deleted, changes coach, or
// moves to its own account.
export async function dropScenicCoachIfIdle(q: Pick<Queryable, "query">, coachId: string | null, who: string) {
  if (!coachId) return;
  const still = await q.query(
    "select 1 from scenic_teams where coach_id = $1 and org_team_id is null and thunder_team_id is null limit 1",
    [coachId],
  );
  if (!still.rowCount) await q.query("select set_role($1, 'scenic-city', 'Coach', false, $2)", [coachId, who]);
}

// An outside club that no longer has anything (no teams, contacts or gyms; not hosting games; not a CourtCaptain
// organization, whose listing goes with it) is taken off Scenic City's partners. Run after a club's team is removed.
export async function removeEmptyClub(q: Pick<Queryable, "query">, partnerId: string | null) {
  if (!partnerId) return;
  await q.query(
    `delete from partners p where p.id = $1 and p.org_slug is null and not p.hosts_games
       and not exists (select 1 from scenic_teams t where t.partner_id = p.id)
       and not exists (select 1 from partner_contacts c where c.partner_id = p.id)
       and not exists (select 1 from partner_gyms g where g.partner_id = p.id)
       and not exists (select 1 from access_requests a where a.partner_id = p.id)`,
    [partnerId],
  );
}

// The coach named by cell: their login (made if new) gets the Scenic City Coach role.
async function coachFor(
  q: Parameters<typeof matchOrCreateUser>[0],
  f: ReturnType<typeof cleanTeam>,
  viewer: SessionUser,
  now: Date,
) {
  const m = await matchOrCreateUser(q, { first: f.first, last: f.last, cell: f.cell, email: null }, now);
  if ("error" in m) throw new TeamError(m.error);
  await q.query("select set_role($1, $2, 'Coach', true, $3), set_role($1, $2, 'Request', false, $3)", [
    m.coachId,
    ORG,
    by(viewer),
  ]);
  return m;
}

export async function createScenicTeam(
  deps: Deps,
  viewer: SessionUser,
  input: TeamInput,
): Promise<Result<{ id: string; newLogin: boolean }>> {
  return run(async () => {
    const f = cleanTeam(input);
    const forWhom = input.for;
    if (forWhom !== "solo" && !isId(forWhom)) throw new TeamError("Pick who the team is for.");
    return withTx(deps.pool, async (q) => {
      if (forWhom === "solo") {
        if (!(await hasRole(q, viewer.coachId, "Solo")))
          throw new TeamError("Only an approved Solo coach can add their own teams.");
      } else {
        const p = await q.query(
          "select 1 from partners where id = $1 and approved and registers_teams and org_slug is null for share",
          [forWhom],
        );
        if (!p.rowCount) throw new TeamError("That partner doesn't register teams.");
        if (!(await isTeamsDirector(q, viewer)) && !(await isContactOf(q, viewer, forWhom)))
          throw new TeamError("Only this partner's contacts or a Scenic City Director of Teams can add its teams.");
      }
      const coach = await coachFor(q, f, viewer, deps.now());
      const t = await q.query<{ id: string }>(
        `insert into scenic_teams (name, gender, grade_low, grade, partner_id, owner_coach_id, coach_id, created_by, created_at, updated_by, updated_at, level)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9, $10) returning id::text`,
        [
          f.name,
          f.gender,
          f.grade.low,
          f.grade.grade,
          forWhom === "solo" ? null : forWhom,
          forWhom === "solo" ? viewer.coachId : null,
          coach.coachId,
          by(viewer),
          deps.now(),
          f.level,
        ],
      );
      return { id: t.rows[0].id, newLogin: coach.newLogin };
    });
  });
}

export async function updateScenicTeam(
  deps: Deps,
  viewer: SessionUser,
  id: unknown,
  input: TeamInput,
): Promise<Result<{ newLogin: boolean }>> {
  if (!isId(id)) return { ok: false, message: "That team no longer exists." };
  return run(async () => {
    const f = cleanTeam(input);
    return withTx(deps.pool, async (q) => {
      const t = await q.query<{
        partner_id: string | null;
        owner_coach_id: string | null;
        org_team_id: string | null;
        coach_id: string | null;
      }>(
        "select partner_id::text, owner_coach_id, coalesce(org_team_id, thunder_team_id)::text as org_team_id, coach_id from scenic_teams where id = $1 for update",
        [id],
      );
      if (!t.rows[0]) throw new TeamError("That team no longer exists.");
      if (t.rows[0].org_team_id) throw new TeamError("This team is managed by its organization.");
      if (!(await canEdit(q, viewer, t.rows[0]))) throw new TeamError("You can't change this team.");
      const coach = await coachFor(q, f, viewer, deps.now());
      await q.query(
        // The coach now has a cell and login: no longer waiting.
        `update scenic_teams set name = $2, gender = $3, grade_low = $4, grade = $5, coach_id = $6, updated_by = $7, updated_at = $8, level = $9,
                coach_first = null, coach_last = null
         where id = $1`,
        [id, f.name, f.gender, f.grade.low, f.grade.grade, coach.coachId, by(viewer), deps.now(), f.level],
      );
      if (t.rows[0].coach_id !== coach.coachId) await dropScenicCoachIfIdle(q, t.rows[0].coach_id, by(viewer));
      return { newLogin: coach.newLogin };
    });
  });
}

// The Head Coach's email when they have none yet (whoever can edit the team). They confirm it with a code at their next
// login.
export async function setScenicCoachEmail(deps: Deps, viewer: SessionUser, id: unknown, email: unknown): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That team no longer exists." };
  const e = cleanEmail(email);
  if (!e) return { ok: false, message: "Enter a real email address." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const t = await q.query<{ partner_id: string | null; owner_coach_id: string | null; coach_id: string | null }>(
        "select partner_id::text, owner_coach_id, coach_id from scenic_teams where id = $1 for update",
        [id],
      );
      if (!t.rows[0]) throw new TeamError("That team no longer exists.");
      if (!(await canEdit(q, viewer, t.rows[0]))) throw new TeamError("You can't change this team.");
      const r = await q.query(
        "update users set email = $2, updated_at = $3, updated_by = $4 where coach_id = $1 and email is null",
        [t.rows[0].coach_id, e, deps.now(), by(viewer)],
      );
      if (!r.rowCount) throw new TeamError("This team's Head Coach already has an email.");
      return {};
    }),
  );
}

export async function deleteScenicTeam(deps: Deps, viewer: SessionUser, id: unknown): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That team no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const t = await q.query<{
        partner_id: string | null;
        owner_coach_id: string | null;
        org_team_id: string | null;
        coach_id: string | null;
      }>(
        "select partner_id::text, owner_coach_id, coalesce(org_team_id, thunder_team_id)::text as org_team_id, coach_id from scenic_teams where id = $1 for update",
        [id],
      );
      if (!t.rows[0]) throw new TeamError("That team no longer exists.");
      if (t.rows[0].org_team_id) throw new TeamError("This team is managed by its organization.");
      if (!(await canEdit(q, viewer, t.rows[0]))) throw new TeamError("You can't change this team.");
      await q.query("delete from scenic_teams where id = $1", [id]);
      await dropScenicCoachIfIdle(q, t.rows[0].coach_id, by(viewer));
      await removeEmptyClub(q, t.rows[0].partner_id); // its club's last team: the club goes too
      return {};
    }),
  );
}

// The teams this person can manage (register into programs, edit): every Scenic City team (outside clubs', CourtSolo;
// never an organization's, which it registers itself) for a Director of Teams, else their
// partners' teams (as a Partner) and their own Solo teams. Sorted Boys then Girls, by grade, then name.
export async function teamsICanManage(
  q: Queryable,
  viewer: SessionUser,
): Promise<
  { id: string; name: string; gender: "Boys" | "Girls" | "Coed"; level: Level; gradeLow: number; grade: number; partnerId: string | null }[]
> {
  const all = await isTeamsDirector(q, viewer);
  const r = await q.query<{
    id: string;
    name: string;
    gender: "Boys" | "Girls" | "Coed";
    level: Level;
    gradeLow: number;
    grade: number;
    partnerId: string | null;
  }>(
    `select t.id::text, t.name, t.gender, t.level, t.grade_low as "gradeLow", t.grade, t.partner_id::text as "partnerId"
       from scenic_teams t
     -- Never an organization's team (CourtOrg or Thunder): it registers from its own organization's Register tab.
     where t.org_team_id is null and t.thunder_team_id is null
       and ($2
        or (has_role($1, 'scenic-city', 'Partner') and t.partner_id in (select partner_id from partner_contacts where coach_id = $1))
        or (has_role($1, 'scenic-city', 'Solo') and t.owner_coach_id = $1))
     order by t.gender, t.grade, t.level, lower(t.name)`,
    [viewer.coachId, all],
  );
  return r.rows;
}
