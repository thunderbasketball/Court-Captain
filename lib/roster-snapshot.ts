// League rosters (SPEC.md section 13): when a team plays its 1st game in a League (a forfeit counts), the League takes a
// snapshot of its roster: its League roster for the rest of the season, whatever changes on its team page after. The
// database saves it (184: just before the first roster change after the game's start, or here when it's first looked
// at). The League's Owners, Admins and Directors of Teams fix one (add or take out a player); who did it is recorded.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanName } from "./auth/validate";
import { birthdateOf, gradeOf } from "./org-rosters";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

export type SnapshotPlayer = {
  id: string;
  first: string;
  last: string;
  grade: string | null;
  jersey: string | null;
  birthdate: string | null;
  addedBy: string | null; // a Director's fix (null: in the snapshot)
  removedBy: string | null;
};
export type LeagueRoster = { programId: string; program: string; firstGame: string; players: SnapshotPlayer[]; mayFix: boolean };

const FIXER = `(acts_as($2, p.org, 'Admin') or (has_role($2, p.org, 'Director')
  and exists (select 1 from active_director_areas a where a.coach_id = $2 and a.org = p.org and a.area = 'teams')))`;

// Saves any snapshot that's due for these League teams (a team's page, its scoresheets, after a score is entered).
export async function takeSnapshots(q: Pick<Queryable, "query">, teamIds: string[], now: Date): Promise<void> {
  if (teamIds.length) await q.query("select scenic_take_snapshots(x, $2) from unnest($1::bigint[]) x", [teamIds, now]);
}

// A League team's League rosters (Leagues whose 1st game it has played and that haven't ended). For pages that already
// checked the viewer may see the team.
export async function leagueRosters(deps: Deps, viewer: SessionUser, teamId: string | null): Promise<LeagueRoster[]> {
  if (!teamId || !isId(teamId)) return [];
  await takeSnapshots(deps.pool, [teamId], deps.now());
  const r = await deps.pool.query<LeagueRoster>(
    `select s.program_id::text as "programId", p.name as program, (s.first_game_at at time zone 'America/New_York')::date::text as "firstGame",
            ${FIXER} as "mayFix",
            coalesce((select json_agg(json_build_object('id', x.id::text, 'first', x.first_name, 'last', x.last_name, 'grade', x.grade,
                        'jersey', x.jersey, 'birthdate', to_char(x.birthdate, 'YYYY-MM-DD'), 'addedBy', x.added_by, 'removedBy', x.removed_by)
                        order by x.removed_by is not null, (case when x.jersey ~ '^[0-9]+$' then x.jersey::int end) nulls last,
                                 lower(x.last_name), lower(x.first_name))
                      from scenic_snapshot_players x where x.program_id = s.program_id and x.team_id = s.team_id), '[]') as players
       from scenic_roster_snapshots s join scenic_programs p on p.id = s.program_id
      where s.team_id = $1 and p.ends_on >= ($3::timestamptz at time zone 'America/New_York')::date
      order by p.starts_on, lower(p.name)`,
    [teamId, viewer.coachId, deps.now()],
  );
  return r.rows;
}

// Whether the viewer may fix this team's League roster.
export async function mayFixSnapshot(q: Pick<Queryable, "query">, viewer: SessionUser, programId: unknown, teamId: unknown): Promise<boolean> {
  if (!isId(programId) || !isId(teamId)) return false;
  const r = await q.query<{ may: boolean }>(
    `select ${FIXER} as may from scenic_roster_snapshots s join scenic_programs p on p.id = s.program_id where s.program_id = $1 and s.team_id = $3`,
    [programId, viewer.coachId, teamId],
  );
  return r.rows[0]?.may === true;
}

const notAllowed = { ok: false as const, message: "Only the League's Owners, Admins and Directors of Teams can fix a League roster." };

export async function addSnapshotPlayer(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  teamId: unknown,
  input: { first?: unknown; last?: unknown; grade?: unknown; jersey?: unknown; birthdate?: unknown },
): Promise<Result> {
  if (!isId(programId) || !isId(teamId)) return { ok: false, message: "That League roster wasn't found." };
  const first = cleanName(input.first);
  const last = cleanName(input.last);
  if (!first || !last) return { ok: false, message: "Enter the player's first and last name (letters only)." };
  const grade = input.grade === undefined || input.grade === "" ? null : gradeOf(input.grade);
  if (input.grade && grade === null) return { ok: false, message: "Grade: K through 12." };
  const jersey = typeof input.jersey === "string" && input.jersey.trim() ? input.jersey.trim() : null;
  if (jersey && !/^[0-9]{1,2}$/.test(jersey)) return { ok: false, message: "Jersey: a number from 0 to 99." };
  const birthdate = birthdateOf(input.birthdate);
  if (birthdate === undefined) return { ok: false, message: "Birthdate: a date like 5/3/2014" };
  return withTx(deps.pool, async (q) => {
    const s = await q.query<{ may: boolean }>(
      `select ${FIXER} as may from scenic_roster_snapshots s join scenic_programs p on p.id = s.program_id
        where s.program_id = $1 and s.team_id = $3 for update of s`,
      [programId, viewer.coachId, teamId],
    );
    if (!s.rows[0]?.may) return notAllowed;
    const there = await q.query(
      `select 1 from scenic_snapshot_players where program_id = $1 and team_id = $2 and removed_by is null
          and lower(first_name) = lower($3) and lower(last_name) = lower($4)`,
      [programId, teamId, first, last],
    );
    if (there.rowCount) return { ok: false as const, message: `${first} ${last} is already on this League roster.` };
    await q.query(
      `insert into scenic_snapshot_players (program_id, team_id, first_name, last_name, grade, jersey, birthdate, added_by, added_at)
       values ($1, $2, $3, $4, $5, $6, $7::date, $8, $9)`,
      [programId, teamId, first, last, grade, jersey, birthdate, by(viewer), deps.now()],
    );
    return { ok: true as const };
  });
}

// Takes a player off (kept, crossed out, with who), or puts one back.
export async function setSnapshotPlayer(deps: Deps, viewer: SessionUser, playerId: unknown, off: unknown): Promise<Result> {
  if (!isId(playerId)) return { ok: false, message: "That player wasn't found." };
  const r = await deps.pool.query(
    `update scenic_snapshot_players x set removed_by = $3, removed_at = $4 from scenic_programs p
      where x.id = $1 and p.id = x.program_id and ${FIXER}`,
    [playerId, viewer.coachId, off === true ? by(viewer) : null, off === true ? deps.now() : null],
  );
  return r.rowCount ? { ok: true } : notAllowed;
}
