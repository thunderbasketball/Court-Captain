// A League team's roster and staff (SPEC.md section 14), on its League team page: Scenic City's League teams kept here
// (the FastBreak club's, outside clubs', Solo teams). Its coach (Head or Assistant) and Scenic City's Directors of Teams,
// Owners and Admins add and remove players (first and last name, grade, jersey number, birthdate) and its other staff
// (Assistant Coach, who gets a login like an organization's; Manager and Team Parent: name, cell, email, contact only). An organization's or Thunder's team
// keeps its roster and staff there. Checked here, on the server; who did it recorded. Names are letters only (no formulas).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanEmail, cleanName } from "./auth/validate";
import { isOrgAdmin, orgHasArea } from "./org-admin";
import { cleanInfo, saveInfo, birthdateOf, checkImportRows, cleanPlayer, gradeOf, importStatus, parsePlayerRows, type ImportLayout, type PlayerImportRow, type PreviewRow } from "./org-rosters";
import { normalizeCell } from "./phone";
import { TEAM_COACHES } from "./scenic-programs";
import { dropScenicCoachIfIdle } from "./scenic-teams";
import { withTx, type Queryable } from "./sql";
import { STAFF_ROLES } from "./team-signup";
import { matchOrCreateUser } from "./user-match";

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

// Who may change this staff spot (the same on every organization's teams): Scenic City's Owners, Admins and Directors of
// Teams and the team's Head Coach or Solo owner any; its Assistant Coach, the Manager and Team Parent.
async function mayChangeStaff(q: Pick<Queryable, "query">, viewer: SessionUser, teamId: string, role: string): Promise<boolean> {
  if (!(await mayManageLeagueTeam(q, viewer, teamId))) return false;
  if (role !== "AsstCoach") return true;
  if ((await orgHasArea(q, viewer.coachId, ORG, "teams")) || (await isOrgAdmin(q, viewer.coachId, ORG))) return true;
  const r = await q.query("select 1 from scenic_teams where id = $1 and (coach_id = $2 or owner_coach_id = $2)", [teamId, viewer.coachId]);
  return !!r.rowCount;
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

// Many at once, like an organization's Import players (the same columns, Preview and fixes).
async function leaguePreview(deps: Deps, viewer: SessionUser, teamId: unknown, parsed: PlayerImportRow[] | string): Promise<Result<{ rows: PreviewRow[] }>> {
  if (!isId(teamId) || !(await mayManageLeagueTeam(deps.pool, viewer, teamId))) return { ok: false, message: notAllowed };
  if (typeof parsed === "string") return { ok: false, message: parsed };
  const have = await deps.pool.query<{ k: string }>("select lower(first_name) || ' ' || lower(last_name) as k from scenic_team_players where team_id = $1", [teamId]);
  return { ok: true, rows: importStatus(parsed, new Set(have.rows.map((r) => r.k))) };
}
export async function previewLeagueImport(deps: Deps, viewer: SessionUser, teamId: unknown, text: unknown, layout?: ImportLayout) {
  if (typeof text !== "string" || !text.trim() || text.length > 50_000) return { ok: false as const, message: "Paste your players or choose a CSV file." };
  return leaguePreview(deps, viewer, teamId, parsePlayerRows(text, layout));
}
export async function previewLeagueRows(deps: Deps, viewer: SessionUser, teamId: unknown, rows: unknown) {
  return leaguePreview(deps, viewer, teamId, checkImportRows(rows));
}
export async function importLeagueRows(deps: Deps, viewer: SessionUser, teamId: unknown, rows: unknown): Promise<Result<{ added: string[]; skipped: string[] }>> {
  if (!isId(teamId) || !(await mayManageLeagueTeam(deps.pool, viewer, teamId))) return { ok: false, message: notAllowed };
  const parsed = checkImportRows(rows);
  if (typeof parsed === "string") return { ok: false, message: parsed };
  return withTx(deps.pool, async (q) => {
    if (!(await q.query("select 1 from scenic_teams where id = $1 for update", [teamId])).rowCount)
      return { ok: false as const, message: "That team wasn't found." };
    const added: string[] = [];
    const skipped: string[] = [];
    for (const raw of parsed) {
      const p = cleanPlayer(raw);
      const name = `${raw.first} ${raw.last}`.trim();
      if (typeof p === "string") {
        skipped.push(`${name}: ${p}`);
        continue;
      }
      const there = await q.query<{ same: boolean }>(
        `select (lower(first_name) = lower($2) and lower(last_name) = lower($3)) as same from scenic_team_players
          where team_id = $1 and ((lower(first_name) = lower($2) and lower(last_name) = lower($3)) or jersey = $4) order by 1 desc`,
        [teamId, p.first, p.last, p.jersey],
      );
      if (there.rows[0]) {
        skipped.push(there.rows[0].same ? `${name}: already on the team` : `${name}: #${p.jersey} is taken`);
        continue;
      }
      await q.query(
        `insert into scenic_team_players (team_id, first_name, last_name, grade, jersey, birthdate, added_by, added_at)
         values ($1, $2, $3, $4, $5, $6::date, $7, $8)`,
        [teamId, p.first, p.last, p.grade, p.jersey, p.birthdate, by(viewer), deps.now()],
      );
      added.push(`${p.first} ${p.last}`);
    }
    return { ok: true as const, added, skipped };
  });
}

// Fill in (or fix) a player's birthdate.
export async function setLeagueBirthdate(deps: Deps, viewer: SessionUser, teamId: unknown, playerId: unknown, birthdate: unknown): Promise<Result> {
  if (!isId(teamId) || !isId(playerId) || !(await mayManageLeagueTeam(deps.pool, viewer, teamId))) return { ok: false, message: notAllowed };
  const b = birthdateOf(birthdate);
  if (!b) return { ok: false, message: "Enter a birthdate like 5/3/2014." };
  const r = await deps.pool.query("update scenic_team_players set birthdate = $3::date where id = $1 and team_id = $2", [playerId, teamId, b]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That player isn't on this team." };
}

// Fix a player's name or grade; who did it is recorded.
export async function setLeaguePlayerInfo(
  deps: Deps,
  viewer: SessionUser,
  teamId: unknown,
  playerId: unknown,
  input: { first?: unknown; last?: unknown; grade?: unknown },
): Promise<Result> {
  if (!isId(teamId) || !isId(playerId) || !(await mayManageLeagueTeam(deps.pool, viewer, teamId))) return { ok: false, message: notAllowed };
  const c = cleanInfo(input);
  if (typeof c === "string") return { ok: false, message: c };
  return withTx(deps.pool, async (q) => {
    if (!(await q.query("select 1 from scenic_teams where id = $1 for update", [teamId])).rowCount)
      return { ok: false as const, message: "That team wasn't found." };
    return saveInfo(q, "scenic_team_players", teamId, playerId, c, by(viewer), deps.now());
  });
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
  if (!(await mayChangeStaff(deps.pool, viewer, teamId, role.key))) return { ok: false, message: notAllowed };
  return withTx(deps.pool, async (q) => {
    await q.query("select 1 from scenic_teams where id = $1 for update", [teamId]);
    const was = (await q.query<{ coach_id: string | null }>("select coach_id from scenic_team_staff where team_id = $1 and role = $2", [teamId, role.key])).rows[0];
    // An Assistant Coach logs in with this cell, like an organization's (the League's Coach role).
    let coachId: string | null = null;
    if (role.key === "AsstCoach") {
      const m = await matchOrCreateUser(q, { first, last, cell, email }, deps.now());
      if ("error" in m) return { ok: false as const, message: m.error };
      coachId = m.coachId;
      if (email) await q.query("update users set email = $2 where coach_id = $1 and email is null", [coachId, email]);
      await q.query("select set_role($1, $2, 'Coach', true, $3), set_role($1, $2, 'Request', false, $3)", [coachId, ORG, by(viewer)]);
    }
    await q.query(
      `insert into scenic_team_staff (team_id, role, first_name, last_name, cell, email, added_by, added_at, coach_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (team_id, role) do update set first_name = excluded.first_name, last_name = excluded.last_name, cell = excluded.cell,
         email = excluded.email, added_by = excluded.added_by, added_at = excluded.added_at, coach_id = excluded.coach_id`,
      [teamId, role.key, first, last, cell, email, by(viewer), deps.now(), coachId],
    );
    if (was?.coach_id && was.coach_id !== coachId) await dropScenicCoachIfIdle(q, was.coach_id, by(viewer));
    return { ok: true as const };
  });
}

export async function removeLeagueStaff(deps: Deps, viewer: SessionUser, teamId: unknown, role: unknown): Promise<Result> {
  if (!isId(teamId) || !STAFF_ROLES.some((r) => r.key === role)) return { ok: false, message: "That staff member wasn't found." };
  if (!(await mayChangeStaff(deps.pool, viewer, teamId, String(role)))) return { ok: false, message: notAllowed };
  return withTx(deps.pool, async (q) => {
    const d = await q.query<{ coach_id: string | null }>("delete from scenic_team_staff where team_id = $1 and role = $2 returning coach_id", [teamId, role]);
    await dropScenicCoachIfIdle(q, d.rows[0]?.coach_id ?? null, by(viewer)); // not coaching here any more
    return { ok: true as const };
  });
}
