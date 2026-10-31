// Team rosters (SPEC.md section 3): the Director puts registered players on a team. The team's staff can see them
// (and take practice attendance from the list). Who rostered each player is recorded.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { withTx } from "./sql";
import { hasArea } from "./org-admin";

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
};

// Sorted by last name. Null when the viewer can't see this team.
export async function listRoster(deps: Deps, viewer: SessionUser, teamId: string): Promise<RosterPlayer[] | null> {
  if (!isId(teamId) || !(await canSeeRoster(deps.pool, viewer, teamId))) return null;
  const r = await deps.pool.query<RosterPlayer>(
    `select p.registrant_id as "registrantId", p.first_name as "firstName", p.last_name as "lastName", p.gender, p.grade,
            p.rostered_by as "rosteredBy", p.rostered_at as "rosteredAt",
            exists (select 1 from registrations g where g.registrant_id = p.registrant_id) as registered
     from team_players p where p.team_id = $1
     order by lower(p.last_name), lower(p.first_name)`,
    [teamId],
  );
  return r.rows;
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

// A player can be on only one team: anyone already on another team is refused (move them on the roster board instead).
export async function addPlayers(deps: Deps, viewer: SessionUser, teamId: unknown, ids: unknown): Promise<Result<{ added: number }>> {
  if (!hasArea(viewer, "teams")) return directorOnly;
  if (!isId(teamId)) return { ok: false, message: "That team no longer exists." };
  const list = Array.isArray(ids) ? [...new Set(ids.filter(isRegistrant))].slice(0, 200) : [];
  if (!list.length) return { ok: false, message: "Pick at least one player." };
  return withTx(deps.pool, async (q) => {
    await lockPlayers(q, list);
    const t = await q.query("select 1 from teams where id = $1", [teamId]);
    if (!t.rows[0]) return { ok: false as const, message: "That team no longer exists." };
    const taken = await q.query<{ name: string; team: string }>(
      `select p.first_name || ' ' || p.last_name as name, t.name as team from team_players p join teams t on t.id = p.team_id
       where p.registrant_id = any($1) and p.team_id <> $2 order by lower(p.last_name)`,
      [list, teamId],
    );
    if (taken.rows.length)
      return {
        ok: false as const,
        message: `Already on another team: ${taken.rows.map((x) => `${x.name} (${x.team})`).join(", ")}. Move them on Players → Roster players.`,
      };
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
export type BoardPlayer = { registrantId: string; firstName: string; lastName: string; grade: string; coachRequest: string | null };
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

// Puts a player on one team (taking them off any other), or takes them off every team (teamId null).
export async function movePlayer(deps: Deps, viewer: SessionUser, registrantId: unknown, teamId: unknown): Promise<Result> {
  if (!hasArea(viewer, "teams")) return directorOnly;
  if (!isRegistrant(registrantId)) return { ok: false, message: "That player isn't registered." };
  if (teamId !== null && !isId(teamId)) return { ok: false, message: "That team no longer exists." };
  return withTx(deps.pool, async (q) => {
    await lockPlayers(q, [registrantId]);
    if (teamId === null) {
      await leaveTeams(q, registrantId, null);
      return { ok: true as const };
    }
    const t = await q.query("select 1 from teams where id = $1", [teamId]);
    if (!t.rows[0]) return { ok: false as const, message: "That team no longer exists." };
    const g = await q.query("select 1 from registrations where registrant_id = $1", [registrantId]);
    if (!g.rows[0]) return { ok: false as const, message: "That player isn't registered." };
    await leaveTeams(q, registrantId, teamId);
    await q.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       select $1, registrant_id, first_name, last_name, gender, grade, grade_sort, $3, $4 from registrations where registrant_id = $2
       on conflict do nothing`,
      [teamId, registrantId, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
    );
    return { ok: true as const };
  });
}
