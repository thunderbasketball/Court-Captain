// Team rosters (SPEC.md section 3): the Director puts registered players on a team. The team's staff can see them
// (and take practice attendance from the list). Who rostered each player is recorded.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { withTx } from "./sql";
import { hasArea } from "./org-admin";
import { normalizeCell } from "./phone";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const directorOnly = { ok: false as const, message: "Only a Director of Teams can change rosters." };
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const isRegistrant = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,40}$/.test(v);

export async function canSeeRoster(q: Pick<Pool, "query">, viewer: SessionUser, teamId: string): Promise<boolean> {
  if (hasArea(viewer, "teams")) return true;
  const r = await q.query("select 1 from team_staff where team_id = $1 and coach_id = $2", [teamId, viewer.coachId]);
  return r.rows.length > 0;
}

export type RosterPlayer = {
  registrantId: string;
  firstName: string;
  lastName: string;
  gender: string;
  grade: string;
  rosteredBy: string;
  rosteredAt: Date;
  registered: boolean; // still in the current registrations
  parents: Parent[]; // from registration, for the team's staff to reach the family
};

export type Parent = { name: string; cell: string | null; email: string | null };

// Sorted by last name. Null when the viewer can't see this team.
export async function listRoster(deps: Deps, viewer: SessionUser, teamId: string): Promise<RosterPlayer[] | null> {
  if (!isId(teamId) || !(await canSeeRoster(deps.pool, viewer, teamId))) return null;
  type Row = Omit<RosterPlayer, "parents"> & Record<`p${1 | 2}${"f" | "l" | "c" | "e"}`, string | null>;
  const r = await deps.pool.query<Row>(
    `select p.registrant_id as "registrantId", p.first_name as "firstName", p.last_name as "lastName", p.gender, p.grade,
            p.rostered_by as "rosteredBy", p.rostered_at as "rosteredAt",
            g.registrant_id is not null as registered,
            g.parent1_first as p1f, g.parent1_last as p1l, g.parent1_cell as p1c, g.parent1_email as p1e,
            g.parent2_first as p2f, g.parent2_last as p2l, g.parent2_cell as p2c, g.parent2_email as p2e
     from team_players p left join registrations g on g.registrant_id = p.registrant_id
     where p.team_id = $1
     order by lower(p.last_name), lower(p.first_name)`,
    [teamId],
  );
  return r.rows.map(({ p1f, p1l, p1c, p1e, p2f, p2l, p2c, p2e, ...x }) => ({
    ...x,
    parents: [parent(p1f, p1l, p1c, p1e), parent(p2f, p2l, p2c, p2e)].filter((v): v is Parent => !!v),
  }));
}

// A parent from registration; a cell only when it's a real 10-digit number, an email only when it looks like one.
export function parent(first: string | null, last: string | null, cell: string | null, email: string | null): Parent | null {
  const c = cell ? normalizeCell(cell) : null;
  const e = email?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim() : null;
  const name = [first, last]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(" ");
  return name || c || e ? { name: name || "Parent", cell: c, email: e } : null;
}

export type RosterCandidate = {
  registrantId: string;
  firstName: string;
  lastName: string;
  gender: string;
  grade: string;
  fits: boolean; // the team's gender and one of its grades
  otherTeams: string[];
};

// Director: registered players not on this team yet. Those who fit the team come first.
export async function rosterCandidates(deps: Deps, viewer: SessionUser, teamId: string): Promise<RosterCandidate[]> {
  if (!hasArea(viewer, "teams") || !isId(teamId)) return [];
  const r = await deps.pool.query<RosterCandidate>(
    `select g.registrant_id as "registrantId", g.first_name as "firstName", g.last_name as "lastName", g.gender, g.grade,
            (g.gender = t.gender and g.grade = any(t.grades)) as fits,
            array(select t2.name from team_players p2 join teams t2 on t2.id = p2.team_id
                  where p2.registrant_id = g.registrant_id order by t2.name) as "otherTeams"
     from registrations g cross join teams t
     where t.id = $1 and not exists (select 1 from team_players p where p.team_id = t.id and p.registrant_id = g.registrant_id)
     order by (g.gender = t.gender and g.grade = any(t.grades)) desc, g.grade_sort, lower(g.last_name), lower(g.first_name)`,
    [teamId],
  );
  return r.rows;
}

// Roster changes lock each player they touch (in id order), so two changes can't put one player on two teams.
async function lockPlayers(q: Pick<Pool, "query">, ids: string[]) {
  for (const id of [...ids].sort()) await q.query("select pg_advisory_xact_lock(hashtext('player:' || $1))", [id]);
}

// Takes a player off every team except `keep` (null: all of them), with their uniform number and size there.
async function leaveTeams(q: Pick<Pool, "query">, registrantId: string, keep: string | null) {
  await q.query("delete from team_players where registrant_id = $1 and team_id::text is distinct from $2", [registrantId, keep]);
  await q.query("delete from team_uniforms where registrant_id = $1 and team_id::text is distinct from $2", [registrantId, keep]);
}

// A player is on one team. Owners, Admins and Directors of Players may also put them on a 2nd team (`second`: they
// confirmed it), never a 3rd. Anyone else adding a player who's already on a team is refused.
export async function addPlayers(
  deps: Deps,
  viewer: SessionUser,
  teamId: unknown,
  ids: unknown,
  second?: unknown,
): Promise<Result<{ added: number }>> {
  if (!hasArea(viewer, "teams")) return directorOnly;
  if (!isId(teamId)) return { ok: false, message: "That team no longer exists." };
  const list = Array.isArray(ids) ? [...new Set(ids.filter(isRegistrant))].slice(0, 200) : [];
  if (!list.length) return { ok: false, message: "Pick at least one player." };
  return withTx(deps.pool, async (q) => {
    await lockPlayers(q, list);
    const t = await q.query("select 1 from teams where id = $1", [teamId]);
    if (!t.rows[0]) return { ok: false as const, message: "That team no longer exists." };
    const taken = await q.query<{ name: string; teams: string[] }>(
      `select min(p.first_name || ' ' || p.last_name) as name, array_agg(t.name order by t.name) as teams
       from team_players p join teams t on t.id = p.team_id
       where p.registrant_id = any($1) and p.team_id <> $2
       group by p.registrant_id order by min(lower(p.last_name))`,
      [list, teamId],
    );
    const named = (rows: { name: string; teams: string[] }[]) => rows.map((x) => `${x.name} (${x.teams.join(", ")})`).join(", ");
    const third = taken.rows.filter((x) => x.teams.length >= 2);
    if (third.length)
      return { ok: false as const, message: `Already on two teams: ${named(third)}. A player can be on two teams at most.` };
    if (taken.rows.length && !hasArea(viewer, "players"))
      return {
        ok: false as const,
        message: `Already on another team: ${named(taken.rows)}. Only an Owner, Admin or Director of Players can put a player on a 2nd team.`,
      };
    if (taken.rows.length && second !== true)
      return { ok: false as const, message: `Already on another team: ${named(taken.rows)}. Confirm to put them on a 2nd team.` };
    const r = await q.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       select $1, registrant_id, first_name, last_name, gender, grade, grade_sort, $3, $4 from registrations where registrant_id = any($2)
       on conflict do nothing`,
      [teamId, list, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
    );
    return { ok: true as const, added: r.rowCount ?? 0 };
  });
}

export async function removePlayer(deps: Deps, viewer: SessionUser, teamId: unknown, registrantId: unknown): Promise<Result> {
  if (!hasArea(viewer, "teams")) return directorOnly;
  if (!isId(teamId) || !isRegistrant(registrantId)) return { ok: false, message: "That player isn't on this team." };
  return withTx(deps.pool, async (q) => {
    const r = await q.query("delete from team_players where team_id = $1 and registrant_id = $2", [teamId, registrantId]);
    if (!r.rowCount) return { ok: false as const, message: "That player isn't on this team." };
    await q.query("delete from team_uniforms where team_id = $1 and registrant_id = $2", [teamId, registrantId]);
    return { ok: true as const };
  });
}

// ---- Roster board (Director, Players page): one gender and grade at a time ----

// coachRequest: the parent's coach request from registration, if any.
export type BoardPlayer = {
  registrantId: string;
  firstName: string;
  lastName: string;
  grade: string;
  coachRequest: string | null;
};
export type BoardTeam = { id: string; name: string; level: string; players: BoardPlayer[] };
export type RosterBoard = { unrostered: BoardPlayer[]; teams: BoardTeam[] };

// The teams named for this grade (same gender, top grade = this grade), each with its whole roster, and the registered
// players they can take who aren't on any team: this grade and one grade below (e.g. 1st grade: 1st and K).
export async function rosterBoard(deps: Deps, viewer: SessionUser, gender: unknown, grade: unknown): Promise<RosterBoard | null> {
  if (!hasArea(viewer, "teams")) return null;
  if ((gender !== "Boys" && gender !== "Girls") || typeof grade !== "string" || !/^(K|\d{1,2})$/.test(grade)) return null;
  const sort = grade === "K" ? 0 : Number(grade);
  const [teams, players, free] = await Promise.all([
    deps.pool.query<Omit<BoardTeam, "players">>(
      `select t.id::text, t.name, t.level from teams t
       where t.gender = $1 and t.grade_sort = $2
       order by t.level = 'COMP' desc, t.grade_sort, lower(t.name)`,
      [gender, sort],
    ),
    deps.pool.query<BoardPlayer & { teamId: string }>(
      `select p.team_id::text as "teamId", p.registrant_id as "registrantId", p.first_name as "firstName", p.last_name as "lastName", p.grade,
              (select nullif(trim(g.coach_request), '') from registrations g where g.registrant_id = p.registrant_id) as "coachRequest"
       from team_players p join teams t on t.id = p.team_id
       where t.gender = $1 and t.grade_sort = $2 order by lower(p.last_name), lower(p.first_name)`,
      [gender, sort],
    ),
    deps.pool.query<BoardPlayer>(
      `select g.registrant_id as "registrantId", g.first_name as "firstName", g.last_name as "lastName", g.grade,
              nullif(trim(g.coach_request), '') as "coachRequest"
       from registrations g where g.gender = $1 and g.grade_sort in ($2, $2 - 1)
         and not exists (select 1 from team_players p where p.registrant_id = g.registrant_id)
       order by g.grade_sort desc, lower(g.last_name), lower(g.first_name)`,
      [gender, sort],
    ),
  ]);
  return {
    unrostered: free.rows,
    teams: teams.rows.map((t) => ({
      ...t,
      players: players.rows
        .filter((p) => p.teamId === t.id)
        .map((p) => ({
          registrantId: p.registrantId,
          firstName: p.firstName,
          lastName: p.lastName,
          grade: p.grade,
          coachRequest: p.coachRequest,
        })),
    })),
  };
}

// ---- Whole roster board (Director, Home's "Not on a team"): every grade at once ----

export type GradeBoard = RosterBoard & { gender: "Boys" | "Girls"; grade: string };

// Boys then Girls, each youngest grade first. In each grade: its registered players not on any team, then the teams
// named for it (top grade = this grade) with their whole rosters. Each grade that has a player or a team is listed.
export async function allRosterBoards(deps: Deps, viewer: SessionUser): Promise<GradeBoard[] | null> {
  if (!hasArea(viewer, "teams")) return null;
  const [teams, players, free] = await Promise.all([
    deps.pool.query<Omit<BoardTeam, "players"> & { gender: string; sort: number }>(
      `select t.id::text, t.name, t.level, t.gender, t.grade_sort as sort from teams t
       where t.gender in ('Boys', 'Girls') and t.grade_sort is not null
       order by t.level = 'COMP' desc, lower(t.name)`,
    ),
    deps.pool.query<BoardPlayer & { teamId: string }>(
      `select p.team_id::text as "teamId", p.registrant_id as "registrantId", p.first_name as "firstName", p.last_name as "lastName", p.grade,
              (select nullif(trim(g.coach_request), '') from registrations g where g.registrant_id = p.registrant_id) as "coachRequest"
       from team_players p order by lower(p.last_name), lower(p.first_name)`,
    ),
    deps.pool.query<BoardPlayer & { gender: string; sort: number }>(
      `select g.registrant_id as "registrantId", g.first_name as "firstName", g.last_name as "lastName", g.grade, g.gender,
              g.grade_sort as sort, nullif(trim(g.coach_request), '') as "coachRequest"
       from registrations g where g.gender in ('Boys', 'Girls') and g.grade_sort is not null
         and not exists (select 1 from team_players p where p.registrant_id = g.registrant_id)
       order by lower(g.last_name), lower(g.first_name)`,
    ),
  ]);
  const boards = new Map<string, GradeBoard & { sort: number }>();
  const board = (gender: string, sort: number) => {
    const key = `${gender}|${sort}`;
    let b = boards.get(key);
    if (!b)
      boards.set(
        key,
        (b = { gender: gender as "Boys" | "Girls", grade: sort === 0 ? "K" : String(sort), sort, unrostered: [], teams: [] }),
      );
    return b;
  };
  const strip = (p: BoardPlayer): BoardPlayer => ({
    registrantId: p.registrantId,
    firstName: p.firstName,
    lastName: p.lastName,
    grade: p.grade,
    coachRequest: p.coachRequest,
  });
  for (const p of free.rows) board(p.gender, p.sort).unrostered.push(strip(p));
  for (const t of teams.rows)
    board(t.gender, t.sort).teams.push({
      id: t.id,
      name: t.name,
      level: t.level,
      players: players.rows.filter((p) => p.teamId === t.id).map(strip),
    });
  return [...boards.values()]
    .sort((a, b) => (a.gender === b.gender ? a.sort - b.sort : a.gender === "Boys" ? -1 : 1))
    .map((b) => ({ gender: b.gender, grade: b.grade, unrostered: b.unrostered, teams: b.teams }));
}

// Puts a player on a team, or takes them off (teamId null). With `from` (the roster board: the team they were dragged
// from, or null from "Not on a team"), only that team is left, so a 2nd team stays; without it, every other team is.
export async function movePlayer(
  deps: Deps,
  viewer: SessionUser,
  registrantId: unknown,
  teamId: unknown,
  from?: unknown,
): Promise<Result> {
  if (!hasArea(viewer, "teams")) return directorOnly;
  if (!isRegistrant(registrantId)) return { ok: false, message: "That player isn't registered." };
  if (teamId !== null && !isId(teamId)) return { ok: false, message: "That team no longer exists." };
  if (from !== undefined && from !== null && !isId(from)) return { ok: false, message: "That team no longer exists." };
  // Leaves the team they came from (board), or every team but `keep`.
  const leave = async (q: Pick<Pool, "query">, keep: string | null) => {
    if (from === undefined) return leaveTeams(q, registrantId, keep);
    if (from === null || from === keep) return;
    await q.query("delete from team_players where registrant_id = $1 and team_id = $2", [registrantId, from]);
    await q.query("delete from team_uniforms where registrant_id = $1 and team_id = $2", [registrantId, from]);
  };
  return withTx(deps.pool, async (q) => {
    await lockPlayers(q, [registrantId]);
    if (teamId === null) {
      await leave(q, null);
      return { ok: true as const };
    }
    const t = await q.query("select 1 from teams where id = $1", [teamId]);
    if (!t.rows[0]) return { ok: false as const, message: "That team no longer exists." };
    const g = await q.query("select 1 from registrations where registrant_id = $1", [registrantId]);
    if (!g.rows[0]) return { ok: false as const, message: "That player isn't registered." };
    await leave(q, teamId);
    await q.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       select $1, registrant_id, first_name, last_name, gender, grade, grade_sort, $3, $4 from registrations where registrant_id = $2
       on conflict do nothing`,
      [teamId, registrantId, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
    );
    return { ok: true as const };
  });
}
