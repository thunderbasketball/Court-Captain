// A League team's roster and staff (SPEC.md section 14), on its League team page: Scenic City's League teams kept here
// (the FastBreak club's, outside clubs', Solo teams). Its coach (Head or Assistant) and Scenic City's Directors of Teams,
// Owners and Admins add and remove players (first and last name, grade, jersey number, birthdate) and its other staff
// (Assistant Coach, Manager, Team Parent: name, cell, email; contact only, no login). An organization's or Thunder's team
// keeps its roster and staff there. Checked here, on the server; who did it recorded. Names are letters only (no formulas).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanEmail, cleanName } from "./auth/validate";
import { isOrgAdmin, orgHasArea } from "./org-admin";
import { birthdateOf, gradeOf } from "./org-rosters";
import { normalizeCell } from "./phone";
import { TEAM_COACHES } from "./scenic-programs";
import type { Queryable } from "./sql";
import { STAFF_ROLES } from "./team-signup";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const ORG = "scenic-city";
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const notAllowed = "Only the team's coach or a Scenic City Director of Teams can change this.";

export type LeaguePlayer = { id: string; first: string; last: string; grade: number | null; jersey: string | null; birthdate: string | null; addedBy: string };

// Whether this team's roster and staff are kept here and the viewer may change them.
export async function mayManageLeagueTeam(q: Pick<Queryable, "query">, viewer: SessionUser, teamId: string): Promise<boolean> {
  if (!isId(teamId)) return false;
  const r = await q.query<{ kept: boolean; coach: boolean }>(
    `select (t.org_team_id is null and t.thunder_team_id is null) as kept,
            (t.coach_id = $2 or t.owner_coach_id = $2
             or exists (select 1 from json_array_elements(${TEAM_COACHES}) x(c) where x.c->>'key' = 'u:' || $2)) as coach
       from scenic_teams t where t.id = $1`,
    [teamId, viewer.coachId],
  );
  const t = r.rows[0];
  if (!t?.kept) return false;
  return t.coach || (await orgHasArea(q, viewer.coachId, ORG, "teams")) || (await isOrgAdmin(q, viewer.coachId, ORG));
}

// The roster, by jersey number (none last), then name.
export async function leagueRoster(q: Pick<Queryable, "query">, teamId: string): Promise<LeaguePlayer[]> {
  const r = await q.query<LeaguePlayer>(
    `select id::text, first_name as first, last_name as last, grade, jersey, to_char(birthdate, 'YYYY-MM-DD') as birthdate, added_by as "addedBy"
       from scenic_team_players where team_id = $1
      order by jersey::int nulls last, lower(last_name), lower(first_name)`,
    [teamId],
  );
  return r.rows;
}

export async function addLeaguePlayer(
  deps: Deps,
  viewer: SessionUser,
  teamId: unknown,
  input: { first?: unknown; last?: unknown; grade?: unknown; jersey?: unknown; birthdate?: unknown },
): Promise<Result<{ id: string }>> {
  if (!isId(teamId)) return { ok: false, message: "That team wasn't found." };
  const first = cleanName(input.first);
  const last = cleanName(input.last);
  if (!first || !last) return { ok: false, message: "Enter the player's first and last name (letters only)." };
  const grade = input.grade === undefined || input.grade === "" ? null : gradeOf(input.grade);
  if (input.grade && grade === null) return { ok: false, message: "Grade: K through 12." };
  const jersey = typeof input.jersey === "string" && input.jersey.trim() ? input.jersey.trim() : null;
  if (jersey && !/^[0-9]{1,2}$/.test(jersey)) return { ok: false, message: "Jersey: a number from 0 to 99." };
  const birthdate = birthdateOf(input.birthdate);
  if (birthdate === undefined) return { ok: false, message: "Birthdate: a date like 5/3/2014" };
  if (!(await mayManageLeagueTeam(deps.pool, viewer, teamId))) return { ok: false, message: notAllowed };
  const r = await deps.pool.query<{ id: string }>(
    `insert into scenic_team_players (team_id, first_name, last_name, grade, jersey, birthdate, added_by, added_at)
     values ($1, $2, $3, $4, $5, $6::date, $7, $8) returning id::text`,
    [teamId, first, last, grade, jersey, birthdate, by(viewer), deps.now()],
  );
  return { ok: true, id: r.rows[0].id };
}

export async function removeLeaguePlayer(deps: Deps, viewer: SessionUser, playerId: unknown): Promise<Result> {
  if (!isId(playerId)) return { ok: false, message: "That player wasn't found." };
  const p = await deps.pool.query<{ team: string }>("select team_id::text as team from scenic_team_players where id = $1", [playerId]);
  if (!p.rows[0]) return { ok: true }; // already gone
  if (!(await mayManageLeagueTeam(deps.pool, viewer, p.rows[0].team))) return { ok: false, message: notAllowed };
  await deps.pool.query("delete from scenic_team_players where id = $1", [playerId]);
  return { ok: true };
}

// Add or replace one of its other staff (one per role).
export async function saveLeagueStaff(
  deps: Deps,
  viewer: SessionUser,
  teamId: unknown,
  input: { role?: unknown; first?: unknown; last?: unknown; cell?: unknown; email?: unknown },
): Promise<Result> {
  if (!isId(teamId)) return { ok: false, message: "That team wasn't found." };
  const role = STAFF_ROLES.find((r) => r.key === input.role);
  if (!role) return { ok: false, message: "Pick Assistant Coach, Manager or Team Parent." };
  const first = cleanName(input.first);
  const last = cleanName(input.last);
  if (!first || !last) return { ok: false, message: `${role.label}: enter a first and last name (letters only).` };
  const cell = typeof input.cell === "string" ? normalizeCell(input.cell) : null;
  if (!cell) return { ok: false, message: `${role.label}: enter a 10-digit cell number.` };
  const email = typeof input.email === "string" && input.email.trim() ? cleanEmail(input.email) : null;
  if (typeof input.email === "string" && input.email.trim() && !email) return { ok: false, message: `${role.label}: check the email.` };
  if (!(await mayManageLeagueTeam(deps.pool, viewer, teamId))) return { ok: false, message: notAllowed };
  await deps.pool.query(
    `insert into scenic_team_staff (team_id, role, first_name, last_name, cell, email, added_by, added_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (team_id, role) do update set first_name = excluded.first_name, last_name = excluded.last_name, cell = excluded.cell,
       email = excluded.email, added_by = excluded.added_by, added_at = excluded.added_at`,
    [teamId, role.key, first, last, cell, email, by(viewer), deps.now()],
  );
  return { ok: true };
}

export async function removeLeagueStaff(deps: Deps, viewer: SessionUser, teamId: unknown, role: unknown): Promise<Result> {
  if (!isId(teamId) || !STAFF_ROLES.some((r) => r.key === role)) return { ok: false, message: "That staff member wasn't found." };
  if (!(await mayManageLeagueTeam(deps.pool, viewer, teamId))) return { ok: false, message: notAllowed };
  await deps.pool.query("delete from scenic_team_staff where team_id = $1 and role = $2", [teamId, role]);
  return { ok: true };
}
