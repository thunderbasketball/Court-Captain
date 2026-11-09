// Teams for any registered organization (SPEC.md section 14, Team Management). Each team belongs to its organization.
// Its Admins and Directors of Teams add and remove teams and coaches; a coach sees their own teams. A coach is named by
// cell: that cell is their login (made if new), and they get the organization's Coach role.
import { SOLO_KIND, leagueNameSql } from "./solo-names";
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanEmail, cleanName } from "./auth/validate";
import { hasFeature } from "./features";
import { orgHasArea } from "./org-admin";
import { isOrgSlug, type OrgSlug } from "./orgs";
import { normalizeCell } from "./phone";
import { cleanPlaceName } from "./scenic-partners";
import { gradeLabel, LEVELS, parseGrade } from "./scenic-teams";
import { parseTeamRows, type ImportRow } from "./team-import-parse";
import { withTx, type Queryable } from "./sql";
import {
  baseName,
  existingTeams,
  gradesOk,
  gradeNum,
  gradeStr,
  isGender,
  preKProblem,
  type Gender,
  namePlanner,
  placeName,
  settleName,
  tbdBase,
  teamName,
  type NamedTeam,
} from "./team-names";
import { matchOrCreateUser } from "./user-match";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
export class TeamError extends Error {}

const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const isCoachId = (v: unknown): v is string => typeof v === "string" && /^\d{7}$/.test(v);
export const COACH_ROLES = [
  { key: "HeadCoach", name: "Head Coach" },
  { key: "AsstCoach", name: "Assistant Coach" },
] as const;
type CoachRole = (typeof COACH_ROLES)[number]["key"];

// Built-in organizations have their own team pages; this is for registered ones with Team Management.
// Returns the organization when it qualifies, else null.
const usable = async (q: Pick<Queryable, "query">, org: unknown): Promise<OrgSlug | null> =>
  isOrgSlug(org) && org !== "thunder" && org !== "scenic-city" && (await hasFeature(q, org, "team-building")) ? org : null;
export const canManageTeams = (q: Pick<Queryable, "query">, viewer: SessionUser, org: OrgSlug) =>
  orgHasArea(q, viewer.coachId, org, "teams");

export type OrgTeamCoach = { id: string; name: string; cell: string; email: string | null; role: CoachRole; addedBy: string };
export type OrgTeam = {
  id: string;
  name: string;
  gender: Gender;
  grade: string; // "3rd" or "3rd/4th"
  level: "COMP" | "REC";
  altName: string | null; // e.g. "Bolts"
  players: number; // on its roster (none yet: ROSTER MUST BE ENTERED)
  createdBy: string;
  coaches: OrgTeamCoach[]; // Head Coach first, then by name
  waitingCoach: { first: string; last: string } | null; // named without a cell yet: COACH CELL MUST BE ENTERED
};

async function teams(q: Pick<Queryable, "query">, org: string, onlyFor: string | null, id: string | null): Promise<OrgTeam[]> {
  const r = await q.query<{
    id: string;
    name: string;
    gender: Gender;
    grade_low: number;
    grade: number;
    level: "COMP" | "REC";
    created_by: string;
    alt_name: string | null;
    players: number;
    coaches: OrgTeamCoach[];
    waiting: OrgTeam["waitingCoach"];
  }>(
    `select t.id::text, t.name, t.gender, t.grade_low, t.grade, t.level, t.created_by, t.alt_name,
            case when t.coach_first is null then null else json_build_object('first', t.coach_first, 'last', t.coach_last) end as waiting,
            (select count(*)::int from org_team_players p where p.team_id = t.id) as players,
            coalesce((select json_agg(json_build_object('id', c.coach_id, 'name', u.first_name || ' ' || u.last_name, 'cell', u.cell,
                                                        'email', u.email, 'role', c.role, 'addedBy', c.added_by)
                                      order by c.role desc, u.last_name, u.first_name)
                      from org_team_coaches c join users u on u.coach_id = c.coach_id where c.team_id = t.id), '[]') as coaches
     from org_teams t
     where t.org = $1 and t.archived_at is null and ($2::text is null or exists (select 1 from org_team_coaches c where c.team_id = t.id and c.coach_id = $2))
       and ($3::bigint is null or t.id = $3)
     order by t.grade = -1 desc, t.gender, t.grade, t.grade_low, lower(t.name)`,
    [org, onlyFor, id],
  );
  return r.rows.map((t) => ({
    id: t.id,
    name: t.name,
    gender: t.gender,
    grade: gradeLabel(t.grade_low, t.grade),
    level: t.level,
    createdBy: t.created_by,
    altName: t.alt_name,
    players: t.players,
    coaches: t.coaches,
    waitingCoach: t.waiting,
  }));
}

// The teams this person sees: all of them for Admins and Directors of Teams, else the ones they coach. Null: none to see.
export async function listOrgTeams(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
): Promise<{ teams: OrgTeam[]; canManage: boolean } | null> {
  const o = await usable(deps.pool, org);
  if (!o) return null;
  const canManage = await canManageTeams(deps.pool, viewer, o);
  const list = await teams(deps.pool, o, canManage ? null : viewer.coachId, null);
  return canManage || list.length ? { teams: list, canManage } : null;
}

export type OrgCoach = { id: string; name: string; cell: string; teams: { id: string; name: string; role: CoachRole }[] };

// Members → Coaches: everyone coaching this organization's teams (by last name), with their teams. Admins and Directors of
// Coaches or Teams. Null: not theirs to see.
export async function listOrgCoaches(deps: Deps, viewer: SessionUser, org: unknown): Promise<OrgCoach[] | null> {
  const o = await usable(deps.pool, org);
  if (!o || !(await orgHasArea(deps.pool, viewer.coachId, o, "teams"))) return null;
  const r = await deps.pool.query<OrgCoach>(
    `select u.coach_id as id, u.first_name || ' ' || u.last_name as name, u.cell,
            json_agg(json_build_object('id', t.id::text, 'name', t.name, 'role', c.role)
                     order by c.role desc, t.gender, t.grade, lower(t.name)) as teams
     from org_team_coaches c join org_teams t on t.id = c.team_id join users u on u.coach_id = c.coach_id
     where t.org = $1
     group by u.coach_id order by lower(u.last_name), lower(u.first_name)`,
    [o],
  );
  return r.rows;
}

export async function getOrgTeam(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  id: unknown,
): Promise<{ team: OrgTeam; canManage: boolean } | null> {
  const o = isId(id) ? await usable(deps.pool, org) : null;
  if (!o) return null;
  const canManage = await canManageTeams(deps.pool, viewer, o);
  const [team] = await teams(deps.pool, o, canManage ? null : viewer.coachId, id as string);
  return team ? { team, canManage } : null;
}

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof TeamError) return { ok: false, message: e.message };
    if ((e as { code?: string }).code === "23505") return { ok: false, message: "There's already a team with that name." };
    throw e;
  }
}

// The organization when this person manages its teams (Admin or Director of Teams, with Team Management), else null.
export async function teamsManagerOf(q: Pick<Queryable, "query">, viewer: SessionUser, org: unknown): Promise<OrgSlug | null> {
  const o = await usable(q, org);
  return o && (await canManageTeams(q, viewer, o)) ? o : null;
}

async function mustManage(q: Pick<Queryable, "query">, viewer: SessionUser, org: unknown): Promise<OrgSlug> {
  const o = await teamsManagerOf(q, viewer, org);
  if (!o) throw new TeamError("Only an Admin or Director of Teams can change teams.");
  return o;
}

// Adding a team: gender, grades (one, or two in a row, as "K" … "12"), level, its Head Coach ("none", "user:<id>" of an
// active user, or a new person { first, last, cell }) and an optional Alternate name. The name is made from them.
export type OrgTeamInput = { gender: unknown; grades: unknown; level: unknown; headCoach?: unknown; altName?: unknown };

// An optional Alternate name ("Bolts"): letters, numbers and simple punctuation, never a formula. Blank: none.
function cleanAlt(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const a = cleanPlaceName(v);
  if (!a) throw new TeamError("Alternate name: letters, numbers and simple punctuation, up to 60 characters.");
  return a;
}

// The Head Coach picked: none, an active user, or a new person (their login is made if new).
export async function resolveHead(q: PoolClient, v: unknown, now: Date): Promise<{ coachId: string; lastName: string } | null> {
  if (v === undefined || v === null || v === "" || v === "none") return null;
  if (typeof v === "string" && /^user:\d{7}$/.test(v)) {
    const u = await q.query<{ last_name: string }>("select last_name from users where coach_id = $1 and active", [v.slice(5)]);
    if (!u.rows[0]) throw new TeamError("That person isn't an active user.");
    return { coachId: v.slice(5), lastName: u.rows[0].last_name };
  }
  const p = v as { first?: unknown; last?: unknown; cell?: unknown };
  const first = cleanName(p?.first);
  const last = cleanName(p?.last);
  const cell = typeof p?.cell === "string" ? normalizeCell(p.cell) : null;
  if (!first || !last || !cell) throw new TeamError("Head Coach: first name, last name and a 10-digit cell.");
  const m = await matchOrCreateUser(q, { first, last, cell, email: null }, now);
  if ("error" in m) throw new TeamError(m.error);
  return { coachId: m.coachId, lastName: m.lastName };
}

// The team's name by the rule (Grade + Gender + Head Coach's last name, or "TBD"), numbered with any team already named
// that ("3G Campbell 1", "3G Campbell 2"). A team keeping its name by the rule keeps its number. Run inside the
// caller's transaction, after locking the organization's teams.
async function ruleName(
  q: Pick<Queryable, "query">,
  org: string,
  gender: Gender,
  grades: string[],
  last: string | null,
  exceptId: string | null,
  current: string | null = null,
): Promise<string> {
  // A CourtSolo account's one team is named for the account ("Magic"), not by the rule.
  const solo = await q.query<{ name: string }>("select name from organizations where slug = $1 and kind = $2", [org, SOLO_KIND]);
  if (solo.rows[0]) return solo.rows[0].name;
  const base = last ? teamName(gender, grades, last) : tbdBase(gender, grades);
  if (current && (current.toLowerCase() === base.toLowerCase() || baseName(current).toLowerCase() === base.toLowerCase()))
    return current;
  const teams = (
    await q.query<NamedTeam>("select id::text, name from org_teams where org = $1 and ($2::bigint is null or id <> $2)", [
      org,
      exceptId,
    ])
  ).rows;
  const { name, renames } = placeName(teams, base);
  for (const r of renames) await setOrgTeamName(q, org, r.id, r.name);
  return name;
}

// A team's name, and its copy's in a league ("ER 5B Harris").
async function setOrgTeamName(q: Pick<Queryable, "query">, org: string, teamId: string, name: string) {
  await q.query("update org_teams set name = $2 where id = $1", [teamId, name]);
  await q.query(
    `update scenic_teams st set name = ${leagueNameSql("o", "$2")}
     from organizations o where st.org_team_id = $1 and o.slug = $3`,
    [teamId, name, org],
  );
}

// After a team leaves a name (renamed or removed): the one left with it drops its number.
async function settleOrgName(q: Pick<Queryable, "query">, org: string, base: string) {
  const teams = (await q.query<NamedTeam>("select id::text, name from org_teams where org = $1", [org])).rows;
  const s = settleName(teams, base);
  if (s) await setOrgTeamName(q, org, s.id, s.name);
}

// A CourtSolo account's one team is made with the account: it can't add or import teams.
async function oneSoloTeam(q: Pick<Queryable, "query">, org: string) {
  const r = await q.query("select 1 from organizations where slug = $1 and kind = $2", [org, SOLO_KIND]);
  if (r.rowCount) throw new TeamError("A CourtSolo account has one team: it can't add or import teams.");
}

const lockTeams = (q: Pick<Queryable, "query">, org: string) =>
  q.query("select pg_advisory_xact_lock(hashtext('org-teams:' || $1))", [org]);

// Re-applies the naming rule after the Head Coach changes (or the coach waiting for a cell); its copy in a league
// follows ("ER 5B Harris").
async function renameOrgTeam(q: PoolClient, org: string, teamId: string) {
  await lockTeams(q, org);
  const t = await q.query<{
    name: string;
    gender: Gender;
    grade_low: number;
    grade: number;
    last: string | null;
    own_name: boolean;
  }>(
    `select t.name, t.gender, t.grade_low, t.grade, coalesce(u.last_name, t.coach_last) as last, t.own_name from org_teams t
     left join org_team_coaches c on c.team_id = t.id and c.role = 'HeadCoach' left join users u on u.coach_id = c.coach_id
     where t.id = $1`,
    [teamId],
  );
  const r = t.rows[0];
  if (r.own_name) return r.name; // a team with its own name (CourtSolo, or brought over from it) keeps it
  const grades = [...new Set([r.grade_low, r.grade])].map(gradeStr);
  const name = await ruleName(q, org, r.gender, grades, r.last, teamId, r.name);
  await setOrgTeamName(q, org, teamId, name);
  if (name !== r.name) await settleOrgName(q, org, baseName(r.name));
  return name;
}

export async function createOrgTeam(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  input: OrgTeamInput,
): Promise<Result<{ id: string; name: string }>> {
  return run(async () => {
    const o = await mustManage(deps.pool, viewer, org);
    const gender = isGender(input.gender) ? input.gender : null;
    if (!gender) throw new TeamError("Pick Boys, Girls or Coed.");
    const grades = Array.isArray(input.grades) ? [...new Set(input.grades as string[])] : [];
    if (!gradesOk(grades, true)) throw new TeamError("Pick one grade, or two next to each other.");
    const level = LEVELS.find((l) => l === input.level);
    if (!level) throw new TeamError("Pick COMP or REC.");
    const preK = preKProblem(gender, grades, level);
    if (preK) throw new TeamError(preK);
    const alt = cleanAlt(input.altName);
    return withTx(deps.pool, async (q) => {
      await lockTeams(q, o);
      await oneSoloTeam(q, o);
      const head = await resolveHead(q, input.headCoach, deps.now());
      const name = await ruleName(q, o, gender, grades, head?.lastName ?? null, null);
      const nums = grades.map(gradeNum).sort((a, b) => a - b);
      const t = await q.query<{ id: string }>(
        `insert into org_teams (org, name, gender, grade_low, grade, level, created_by, created_at, alt_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id::text`,
        [o, name, gender, nums[0], nums.at(-1), level, by(viewer), deps.now(), alt],
      );
      if (head) {
        await q.query(
          "insert into org_team_coaches (team_id, coach_id, role, added_by, added_at) values ($1, $2, 'HeadCoach', $3, $4)",
          [t.rows[0].id, head.coachId, by(viewer), deps.now()],
        );
        await q.query("select set_role($1, $2, 'Coach', true, $3), set_role($1, $2, 'Request', false, $3)", [
          head.coachId,
          o,
          by(viewer),
        ]);
      }
      return { id: t.rows[0].id, name };
    });
  });
}

// Change a team's Alternate name (blank removes it).
export async function setOrgTeamAltName(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  id: unknown,
  alt: unknown,
): Promise<Result> {
  return run(async () => {
    if (!isId(id)) throw new TeamError("That team no longer exists.");
    const o = await mustManage(deps.pool, viewer, org);
    const r = await deps.pool.query("update org_teams set alt_name = $3 where id = $1 and org = $2", [id, o, cleanAlt(alt)]);
    if (!r.rowCount) throw new TeamError("That team no longer exists.");
    return {};
  });
}

// ---- A Head Coach named without a cell yet ----

// Fix the waiting coach's name, or remove them (null: "TBD" again). Only while the team has no Head Coach; adding their
// cell (addOrgTeamCoach, Head Coach) makes them the Head Coach.
export async function setOrgWaitingCoach(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  teamId: unknown,
  input: { first: unknown; last: unknown } | null,
): Promise<Result<{ name: string }>> {
  return run(async () => {
    if (!isId(teamId)) throw new TeamError("That team no longer exists.");
    const first = input ? cleanName(input.first) : null;
    const last = input ? cleanName(input.last) : null;
    if (input && (!first || !last)) throw new TeamError("Enter the coach's first and last name (letters only).");
    const o = await mustManage(deps.pool, viewer, org);
    return withTx(deps.pool, async (q) => {
      const t = await q.query("select 1 from org_teams where id = $1 and org = $2 for update", [teamId, o]);
      if (!t.rowCount) throw new TeamError("That team no longer exists.");
      const head = await q.query("select 1 from org_team_coaches where team_id = $1 and role = 'HeadCoach'", [teamId]);
      if (head.rowCount) throw new TeamError("This team already has a Head Coach.");
      await q.query("update org_teams set coach_first = $2, coach_last = $3 where id = $1", [teamId, first, last]);
      return { name: await renameOrgTeam(q, o, teamId) };
    });
  });
}

// The Head Coach's email when they have none yet (they confirm it with a code at their next login).
export async function setOrgHeadCoachEmail(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  teamId: unknown,
  email: unknown,
): Promise<Result> {
  return run(async () => {
    if (!isId(teamId)) throw new TeamError("That team no longer exists.");
    const e = cleanEmail(email);
    if (!e) throw new TeamError("Enter a real email address.");
    const o = await mustManage(deps.pool, viewer, org);
    const r = await deps.pool.query(
      `update users u set email = $3, updated_at = $4, updated_by = $5
       from org_team_coaches c join org_teams t on t.id = c.team_id
       where c.team_id = $1 and t.org = $2 and c.role = 'HeadCoach' and c.coach_id = u.coach_id and u.email is null`,
      [teamId, o, e, deps.now(), by(viewer)],
    );
    if (!r.rowCount) throw new TeamError("This team's Head Coach already has an email.");
    return {};
  });
}

// Removing a team removes its coaches from it; anyone left coaching nothing here loses the Coach role.
export async function deleteOrgTeam(deps: Deps, viewer: SessionUser, org: unknown, id: unknown): Promise<Result> {
  return run(async () => {
    if (!isId(id)) throw new TeamError("That team no longer exists.");
    const o = await mustManage(deps.pool, viewer, org);
    return withTx(deps.pool, async (q) => {
      const coaches = await q.query<{ coach_id: string }>(
        "select c.coach_id from org_team_coaches c join org_teams t on t.id = c.team_id where t.id = $1 and t.org = $2",
        [id, o],
      );
      await lockTeams(q, o);
      const d = await q.query<{ name: string }>("delete from org_teams where id = $1 and org = $2 returning name", [id, o]);
      if (!d.rowCount) throw new TeamError("That team no longer exists.");
      await settleOrgName(q, o, baseName(d.rows[0].name));
      for (const c of coaches.rows) await dropCoachRoleIfIdle(q, o, c.coach_id, viewer);
      return {};
    });
  });
}

async function dropCoachRoleIfIdle(q: Pick<Queryable, "query">, org: string, coachId: string, viewer: SessionUser) {
  const still = await q.query(
    "select 1 from org_team_coaches c join org_teams t on t.id = c.team_id where t.org = $1 and c.coach_id = $2 limit 1",
    [org, coachId],
  );
  if (!still.rowCount) await q.query("select set_role($1, $2, 'Coach', false, $3)", [coachId, org, by(viewer)]);
}

export type OrgCoachInput = { first: unknown; last: unknown; cell: unknown; role: unknown; email?: unknown };

// Add a coach by name and cell (their login is made if new). One Head Coach per team.
export async function addOrgTeamCoach(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  teamId: unknown,
  input: OrgCoachInput,
): Promise<Result<{ name: string; newLogin: boolean }>> {
  return run(async () => {
    if (!isId(teamId)) throw new TeamError("That team no longer exists.");
    const first = cleanName(input.first);
    const last = cleanName(input.last);
    if (!first || !last) throw new TeamError("Enter the coach's first and last name (letters only).");
    const cell = typeof input.cell === "string" ? normalizeCell(input.cell) : null;
    if (!cell) throw new TeamError("Enter the coach's 10-digit cell number.");
    const role = COACH_ROLES.find((r) => r.key === input.role);
    if (!role) throw new TeamError("Pick Head Coach or Assistant Coach.");
    const email = input.email ? cleanEmail(input.email) : null;
    if (input.email && !email) throw new TeamError("Enter a real email address (or leave it blank).");
    const o = await mustManage(deps.pool, viewer, org);
    return withTx(deps.pool, async (q) => {
      const t = await q.query("select 1 from org_teams where id = $1 and org = $2 for update", [teamId, o]);
      if (!t.rowCount) throw new TeamError("That team no longer exists.");
      if (role.key === "HeadCoach") {
        const head = await q.query("select 1 from org_team_coaches where team_id = $1 and role = 'HeadCoach'", [teamId]);
        if (head.rowCount) throw new TeamError("This team already has a Head Coach. Remove them first.");
      }
      const m = await matchOrCreateUser(q, { first, last, cell, email }, deps.now());
      if ("error" in m) throw new TeamError(m.error);
      if (email) await q.query("update users set email = $2 where coach_id = $1 and email is null", [m.coachId, email]);
      const ins = await q.query(
        `insert into org_team_coaches (team_id, coach_id, role, added_by, added_at) values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [teamId, m.coachId, role.key, by(viewer), deps.now()],
      );
      if (!ins.rowCount) throw new TeamError(`${m.who} already coaches this team.`);
      // Its copy in a league (Scenic City) shows the new Head Coach; the team takes their last name ("4G Epps").
      if (role.key === "HeadCoach") {
        // A coach waiting for a cell is replaced by the real one.
        await q.query("update org_teams set coach_first = null, coach_last = null where id = $1", [teamId]);
        await q.query("update scenic_teams set coach_id = $2 where org_team_id = $1", [teamId, m.coachId]);
        await renameOrgTeam(q, o, teamId);
      }
      await q.query("select set_role($1, $2, 'Coach', true, $3), set_role($1, $2, 'Request', false, $3)", [
        m.coachId,
        o,
        by(viewer),
      ]);
      return { name: m.who, newLogin: m.newLogin };
    });
  });
}

export async function removeOrgTeamCoach(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  teamId: unknown,
  coachId: unknown,
): Promise<Result> {
  return run(async () => {
    if (!isId(teamId) || !isCoachId(coachId)) throw new TeamError("That coach isn't on this team.");
    const o = await mustManage(deps.pool, viewer, org);
    return withTx(deps.pool, async (q) => {
      const d = await q.query(
        `delete from org_team_coaches c using org_teams t
         where c.team_id = t.id and t.id = $1 and t.org = $2 and c.coach_id = $3`,
        [teamId, o, coachId],
      );
      if (!d.rowCount) throw new TeamError("That coach isn't on this team.");
      // Its copy in a league (Scenic City) loses them as its coach; with no Head Coach the team is "TBD" again.
      await q.query("update scenic_teams set coach_id = null where org_team_id = $1 and coach_id = $2", [teamId, coachId]);
      await renameOrgTeam(q, o, teamId);
      await dropCoachRoleIfIdle(q, o, coachId, viewer);
      return {};
    });
  });
}

// ---- Adding many teams at once (pasted or a CSV) ----

export type ImportPreviewRow = ImportRow & { status: "new" | "exists" | "error"; gradeLabel: string | null };

// Each row with what will happen: a new team, already there (skipped), or a problem to fix (skipped). Checked against
// the organization's teams; a name listed twice is a problem on its second row.
// Grades as the import reads them ("3" or "3-4", K = 0) → as the naming rule wants them ("K" … "12").
const importGrades = (g: string) => g.split("-").map((x) => (x === "0" ? "K" : x));

async function previewRows(q: Pick<Queryable, "query">, org: string, text: string) {
  const parsed = parseTeamRows(text, { named: false, cellOptional: true });
  const { tooMany } = parsed;
  const teams = (
    await q.query<{ id: string; name: string; level: string; alt: string | null }>(
      "select id::text, name, level, lower(alt_name) as alt from org_teams where org = $1",
      [org],
    )
  ).rows;
  // A team is already there by its name (numbered or not) and level, or (no coach yet, so no name to match) by its
  // Alternate name.
  const there = existingTeams(teams);
  const alts = new Set(teams.filter((t) => t.alt).map((t) => t.alt!));
  // Each new team's name, numbered when the same as another's ("3G Campbell 1", "3G Campbell 2").
  const plan = namePlanner(teams);
  const seenAlt = new Set<string>();
  const rows: ImportPreviewRow[] = parsed.rows.map((p, i) => {
    const grades = p.grade ? importGrades(p.grade) : null;
    const base = p.gender && grades ? (p.coach ? teamName(p.gender, grades, p.coach.last) : tbdBase(p.gender, grades)) : "";
    const alt = !p.coach && p.altName ? p.altName.toLowerCase() : "";
    const errors = [...p.errors, ...(alt && seenAlt.has(alt) ? ["Listed twice"] : [])];
    if (alt) seenAlt.add(alt);
    const status = errors.length ? "error" : (p.coach ? there(base, p.level) : !!alt && alts.has(alt)) ? "exists" : "new";
    const fixes = status === "new" ? [...p.fixes, ...plan.add(`row:${i}`, base)] : p.fixes;
    if (status === "new" && p.coach && !p.coach.cell)
      fixes.push(`${p.coach.first} ${p.coach.last} has no cell yet: the team waits for it (COACH CELL MUST BE ENTERED)`);
    const g = p.grade ? parseGrade(p.grade) : null;
    return { ...p, name: base, fixes, errors, gradeLabel: g ? gradeLabel(g.low, g.grade) : null, status };
  });
  // Names as they'll be once every row is added (a later row can number an earlier one).
  const out = rows.map((r, i) => (r.status === "new" ? { ...r, name: plan.nameOf(`row:${i}`) } : r));
  return { rows: out, tooMany };
}

export async function previewTeamImport(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  text: unknown,
): Promise<Result<{ rows: ImportPreviewRow[]; tooMany: boolean }>> {
  return run(async () => {
    const o = await mustManage(deps.pool, viewer, org);
    if (typeof text !== "string" || !text.trim()) throw new TeamError("Paste your teams or choose a CSV file.");
    if (text.length > 200_000) throw new TeamError("That's too much at once. Up to 200 teams.");
    return previewRows(deps.pool, o, text);
  });
}

// Add every new team in one go (each with its Head Coach, if given: their login is made if new). Rows already there or
// with a problem are skipped and named. Checked again here, not trusted from the preview.
export async function importTeams(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  text: unknown,
): Promise<Result<{ added: string[]; skipped: string[] }>> {
  return run(async () => {
    const o = await mustManage(deps.pool, viewer, org);
    if (typeof text !== "string" || !text.trim()) throw new TeamError("Paste your teams or choose a CSV file.");
    if (text.length > 200_000) throw new TeamError("That's too much at once. Up to 200 teams.");
    return withTx(deps.pool, async (q) => {
      await q.query("select pg_advisory_xact_lock(hashtext('org-teams:' || $1))", [o]);
      await oneSoloTeam(q, o);
      const { rows } = await previewRows(q, o, text);
      // The batch, so it can be undone.
      const batch = (
        await q.query<{ id: string }>(
          "insert into org_team_imports (org, imported_by, imported_at, teams) values ($1, $2, $3, 0) returning id::text",
          [o, by(viewer), deps.now()],
        )
      ).rows[0].id;
      const added: string[] = [];
      const skipped: string[] = [];
      for (const r of rows) {
        if (r.status !== "new") {
          skipped.push(`${r.name || `Row ${r.line}`}: ${r.status === "exists" ? "already a team" : r.errors.join("; ")}`);
          continue;
        }
        const g = parseGrade(r.grade)!;
        // With a cell: their login (made if new). Without one yet: the team waits for it, named for them.
        const c = r.coach;
        const m = c?.cell
          ? await matchOrCreateUser(q, { first: c.first, last: c.last, cell: c.cell, email: c.email }, deps.now())
          : null;
        if (m && "error" in m) {
          skipped.push(`${r.name}: ${m.error}`);
          continue;
        }
        if (m && c?.email)
          await q.query("update users set email = $2 where coach_id = $1 and email is null", [m.coachId, c.email]);
        const waiting = c && !c.cell ? c : null;
        // Named by the rule from the coach's last name as it is on their login (or "TBD"); numbered when taken.
        const name = await ruleName(q, o, r.gender!, importGrades(r.grade!), m?.lastName ?? waiting?.last ?? null, null);
        const t = await q.query<{ id: string }>(
          `insert into org_teams (org, name, gender, grade_low, grade, level, created_by, created_at, import_id, alt_name, coach_first, coach_last)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id::text`,
          [
            o,
            name,
            r.gender,
            g.low,
            g.grade,
            r.level,
            by(viewer),
            deps.now(),
            batch,
            r.altName,
            waiting?.first ?? null,
            waiting?.last ?? null,
          ],
        );
        if (m) {
          await q.query(
            "insert into org_team_coaches (team_id, coach_id, role, added_by, added_at) values ($1, $2, 'HeadCoach', $3, $4)",
            [t.rows[0].id, m.coachId, by(viewer), deps.now()],
          );
          await q.query("select set_role($1, $2, 'Coach', true, $3), set_role($1, $2, 'Request', false, $3)", [
            m.coachId,
            o,
            by(viewer),
          ]);
        }
        added.push(name);
      }
      if (added.length) await q.query("update org_team_imports set teams = $2 where id = $1", [batch, added.length]);
      else await q.query("delete from org_team_imports where id = $1", [batch]);
      // As named now: a later team can have numbered an earlier one ("3G Campbell 1").
      const names = await q.query<{ name: string }>("select name from org_teams where import_id = $1 order by id", [batch]);
      return { added: names.rows.map((x) => x.name), skipped };
    });
  });
}

export type TeamImport = {
  id: string;
  importedBy: string;
  importedAt: Date;
  teams: number; // added by it
  left: number; // still there (not removed or undone)
  undoneBy: string | null;
  names: string[]; // its teams still there
};

// The organization's recent imports not undone and with teams still there (newest first, each with its teams), for Undo.
export async function listTeamImports(deps: Deps, viewer: SessionUser, org: unknown): Promise<TeamImport[] | null> {
  const o = await teamsManagerOf(deps.pool, viewer, org);
  if (!o) return null;
  const r = await deps.pool.query<TeamImport>(
    `select i.id::text, i.imported_by as "importedBy", i.imported_at as "importedAt", i.teams, i.undone_by as "undoneBy",
            (select count(*)::int from org_teams t where t.import_id = i.id) as left,
            array(select t.name from org_teams t where t.import_id = i.id order by lower(t.name)) as names
     from org_team_imports i where i.org = $1 and i.undone_by is null and exists (select 1 from org_teams t where t.import_id = i.id) order by i.imported_at desc limit 5`,
    [o],
  );
  return r.rows;
}

// Undo an import: remove its teams that are still there (their coaches come off; anyone left coaching nothing here
// loses the Coach role). A team already registered in a league program is kept and named; withdraw it first.
export async function undoTeamImport(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  importId: unknown,
): Promise<Result<{ removed: string[]; kept: string[] }>> {
  return run(async () => {
    if (!isId(importId)) throw new TeamError("That import no longer exists.");
    const o = await mustManage(deps.pool, viewer, org);
    return withTx(deps.pool, async (q) => {
      const i = await q.query<{ undone_by: string | null }>(
        "select undone_by from org_team_imports where id = $1 and org = $2 for update",
        [importId, o],
      );
      if (!i.rows[0]) throw new TeamError("That import no longer exists.");
      if (i.rows[0].undone_by) throw new TeamError(`${i.rows[0].undone_by} already undid it.`);
      const teams = await q.query<{ id: string; name: string; registered: boolean }>(
        `select t.id::text, t.name,
                exists (select 1 from scenic_teams st join scenic_registrations r on r.team_id = st.id where st.org_team_id = t.id) as registered
         from org_teams t where t.import_id = $1 and t.org = $2 order by t.gender, t.grade, lower(t.name) for update`,
        [importId, o],
      );
      const removed: string[] = [];
      const kept: string[] = [];
      for (const t of teams.rows) {
        if (t.registered) {
          kept.push(t.name);
          continue;
        }
        const coaches = await q.query<{ coach_id: string }>("select coach_id from org_team_coaches where team_id = $1", [t.id]);
        await q.query("delete from org_teams where id = $1", [t.id]);
        for (const c of coaches.rows) await dropCoachRoleIfIdle(q, o, c.coach_id, viewer);
        removed.push(t.name);
      }
      for (const b of new Set(removed.map(baseName))) await settleOrgName(q, o, b);
      if (!kept.length)
        await q.query("update org_team_imports set undone_by = $2, undone_at = $3 where id = $1", [
          importId,
          by(viewer),
          deps.now(),
        ]);
      return { removed, kept };
    });
  });
}
