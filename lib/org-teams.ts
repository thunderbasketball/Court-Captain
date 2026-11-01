// Teams for any registered organization (SPEC.md section 14, Team Management). Each team belongs to its organization.
// Its Admins and Directors of Teams add and remove teams and coaches; a coach sees their own teams. A coach is named by
// cell: that cell is their login (made if new), and they get the organization's Coach role.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanName } from "./auth/validate";
import { hasFeature } from "./features";
import { orgHasArea } from "./org-admin";
import { isOrgSlug, type OrgSlug } from "./orgs";
import { normalizeCell } from "./phone";
import { cleanPlaceName } from "./scenic-partners";
import { gradeLabel, LEVELS, parseGrade } from "./scenic-teams";
import { withTx, type Queryable } from "./sql";
import { matchOrCreateUser } from "./user-match";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
class TeamError extends Error {}

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

export type OrgTeamCoach = { id: string; name: string; role: CoachRole; addedBy: string };
export type OrgTeam = {
  id: string;
  name: string;
  gender: "Boys" | "Girls";
  grade: string; // "3rd" or "3rd/4th"
  level: "COMP" | "REC";
  createdBy: string;
  coaches: OrgTeamCoach[]; // Head Coach first, then by name
};

async function teams(q: Pick<Queryable, "query">, org: string, onlyFor: string | null, id: string | null): Promise<OrgTeam[]> {
  const r = await q.query<{
    id: string;
    name: string;
    gender: "Boys" | "Girls";
    grade_low: number;
    grade: number;
    level: "COMP" | "REC";
    created_by: string;
    coaches: OrgTeamCoach[];
  }>(
    `select t.id::text, t.name, t.gender, t.grade_low, t.grade, t.level, t.created_by,
            coalesce((select json_agg(json_build_object('id', c.coach_id, 'name', u.first_name || ' ' || u.last_name,
                                                        'role', c.role, 'addedBy', c.added_by)
                                      order by c.role desc, u.last_name, u.first_name)
                      from org_team_coaches c join users u on u.coach_id = c.coach_id where c.team_id = t.id), '[]') as coaches
     from org_teams t
     where t.org = $1 and ($2::text is null or exists (select 1 from org_team_coaches c where c.team_id = t.id and c.coach_id = $2))
       and ($3::bigint is null or t.id = $3)
     order by t.gender, t.grade, t.grade_low, lower(t.name)`,
    [org, onlyFor, id],
  );
  return r.rows.map((t) => ({
    id: t.id,
    name: t.name,
    gender: t.gender,
    grade: gradeLabel(t.grade_low, t.grade),
    level: t.level,
    createdBy: t.created_by,
    coaches: t.coaches,
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
  if (!o || !(await orgHasArea(deps.pool, viewer.coachId, o, "coaches", "teams"))) return null;
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

export type OrgTeamInput = { name: unknown; gender: unknown; grade: unknown; level: unknown };

export async function createOrgTeam(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  input: OrgTeamInput,
): Promise<Result<{ id: string }>> {
  return run(async () => {
    const o = await mustManage(deps.pool, viewer, org);
    // Team names: letters, numbers and simple punctuation, starting with a letter or number (never a formula).
    const name = cleanPlaceName(input.name);
    if (!name) throw new TeamError("Enter a team name: letters, numbers and simple punctuation, up to 60 characters.");
    const gender = input.gender === "Boys" || input.gender === "Girls" ? input.gender : null;
    if (!gender) throw new TeamError("Pick Boys or Girls.");
    const grade = parseGrade(input.grade);
    if (!grade) throw new TeamError("Pick a grade.");
    const level = LEVELS.find((l) => l === input.level);
    if (!level) throw new TeamError("Pick COMP or REC.");
    const t = await deps.pool.query<{ id: string }>(
      `insert into org_teams (org, name, gender, grade_low, grade, level, created_by, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::text`,
      [o, name, gender, grade.low, grade.grade, level, by(viewer), deps.now()],
    );
    return { id: t.rows[0].id };
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
      const d = await q.query("delete from org_teams where id = $1 and org = $2", [id, o]);
      if (!d.rowCount) throw new TeamError("That team no longer exists.");
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

export type OrgCoachInput = { first: unknown; last: unknown; cell: unknown; role: unknown };

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
    const o = await mustManage(deps.pool, viewer, org);
    return withTx(deps.pool, async (q) => {
      const t = await q.query("select 1 from org_teams where id = $1 and org = $2 for update", [teamId, o]);
      if (!t.rowCount) throw new TeamError("That team no longer exists.");
      if (role.key === "HeadCoach") {
        const head = await q.query("select 1 from org_team_coaches where team_id = $1 and role = 'HeadCoach'", [teamId]);
        if (head.rowCount) throw new TeamError("This team already has a Head Coach. Remove them first.");
      }
      const m = await matchOrCreateUser(q, { first, last, cell, email: null }, deps.now());
      if ("error" in m) throw new TeamError(m.error);
      const ins = await q.query(
        `insert into org_team_coaches (team_id, coach_id, role, added_by, added_at) values ($1, $2, $3, $4, $5)
         on conflict do nothing`,
        [teamId, m.coachId, role.key, by(viewer), deps.now()],
      );
      if (!ins.rowCount) throw new TeamError(`${m.who} already coaches this team.`);
      // Its copy in a league (Scenic City) shows the new Head Coach.
      if (role.key === "HeadCoach")
        await q.query("update scenic_teams set coach_id = $2 where org_team_id = $1", [teamId, m.coachId]);
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
      // Its copy in a league (Scenic City) loses them as its coach.
      await q.query("update scenic_teams set coach_id = null where org_team_id = $1 and coach_id = $2", [teamId, coachId]);
      await dropCoachRoleIfIdle(q, o, coachId, viewer);
      return {};
    });
  });
}
