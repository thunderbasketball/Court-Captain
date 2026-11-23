// Find my player's team (public pages, no login; SPEC.md section 13). A parent enters their cell; if a player's
// registration has that cell for a parent, a code goes to that parent's email on it. The answer is the same either way,
// so the page never tells whether a number is registered. With the code: each of their players, the team they're on, its
// staff, and its coming practices and published games. Codes: the usual limits (a few an hour, a few tries each).
import type { Deps } from "./auth/service";
import { checkCode, issueCode, lockCell } from "./auth/service";
import { cleanEmail } from "./auth/validate";
import { normalizeCell } from "./phone";
import { upcomingForTeam, type TeamPractice } from "./practice/schedule";
import { scheduledGames, type ScheduledGame } from "./scenic-games";
import { withTx } from "./sql";
import { upcomingOwnPractices, type OwnPractice } from "./team-practices";
import { easternDate } from "./time";

export const CODE_SENT =
  "If a player is registered with that cell, we emailed a code to the parent's email on the registration. It works for 10 minutes. Not in the inbox? Check the Spam folder.";

export type FoundTeam = {
  name: string;
  staff: { role: string; name: string; cell: string }[];
  games: ScheduledGame[]; // published, today on
  practices: TeamPractice[];
  own: OwnPractice[];
};
export type FoundPlayer = {
  id: string;
  name: string;
  grade: string; // "Boys 5th"
  org: string;
  program: string | null;
  team: FoundTeam | null;
};
export type FindStep =
  | { step: "code"; message: string }
  | { step: "found"; players: FoundPlayer[] }
  | { step: "error"; message: string };

const ROLE: Record<string, string> = { HeadCoach: "Head Coach", AsstCoach: "Asst Coach", Manager: "Team Manager", TeamParent: "Team Parent" };
const gradeName = (g: string) => (g === "K" ? "K" : g === "PK" ? "Pre-K" : `${g}${["", "st", "nd", "rd"][Number(g)] ?? "th"}`);
const cellOf = (input: unknown) => (typeof input === "string" ? normalizeCell(input) : null);

// Step 1: the cell. Sends a code when it's a parent's on a registration (to that parent's newest email there).
export async function findStart(deps: Deps, cellInput: unknown): Promise<FindStep> {
  const cell = cellOf(cellInput);
  if (!cell) return { step: "error", message: "Enter your 10-digit cell number." };
  const r = await deps.pool.query<{ email: string | null }>(
    `select case when parent1_cell = $1 then parent1_email else parent2_email end as email
       from registrations where parent1_cell = $1 or parent2_cell = $1
      order by coalesce(registered_at, added_at) desc nulls last`,
    [cell],
  );
  const email = r.rows.map((x) => cleanEmail(x.email)).find((e) => !!e) ?? null;
  if (email) {
    const fail = await withTx(deps.pool, async (q) => {
      await lockCell(q, cell);
      return issueCode(deps, q, cell, "find", email);
    });
    if (fail?.step === "error") return fail;
  }
  return { step: "code", message: CODE_SENT };
}

// Step 2: the code. Their players (current programs: not ended more than 30 days ago) and their teams.
export async function findComplete(deps: Deps, cellInput: unknown, code: unknown): Promise<FindStep> {
  const cell = cellOf(cellInput);
  if (!cell) return { step: "error", message: "Enter your 10-digit cell number." };
  const c = await withTx(deps.pool, async (q) => {
    await lockCell(q, cell);
    return checkCode(deps, q, cell, "find", code);
  });
  if (!c.ok) return c.step.step === "error" ? c.step : { step: "error", message: "That code didn't work. Send a new one." };
  return { step: "found", players: await playersOf(deps, cell) };
}

export async function playersOf(deps: Pick<Deps, "pool" | "now">, cell: string): Promise<FoundPlayer[]> {
  const today = easternDate(deps.now());
  const r = await deps.pool.query<{
    id: string;
    name: string;
    gender: string;
    grade: string;
    org: string;
    program: string | null;
    team_id: string | null;
    team: string | null;
  }>(
    `select r.registrant_id as id, r.first_name || ' ' || r.last_name as name, r.gender, r.grade,
            coalesce(o.short_name, o.name, 'Thunder') as org, coalesce(pp.name, nullif(trim(r.program), '')) as program,
            t.id::text as team_id, t.name as team
       from registrations r
       left join player_programs pp on pp.id = r.program_id
       left join organizations o on o.slug = coalesce(pp.org, 'thunder')
       left join lateral (select x.id, x.name from team_players p join teams x on x.id = p.team_id
                           where p.registrant_id = r.registrant_id order by x.name limit 1) t on true
      where (r.parent1_cell = $1 or r.parent2_cell = $1)
        and (pp.ends_on is null or pp.ends_on >= $2::date - 30)
      order by lower(r.first_name), lower(r.last_name)`,
    [cell, today],
  );
  const teamIds = [...new Set(r.rows.map((p) => p.team_id).filter((t): t is string => !!t))];
  const teams = new Map(await Promise.all(teamIds.map(async (id) => [id, await teamOf(deps, id, today)] as const)));
  return r.rows.map((p) => ({
    id: p.id,
    name: p.name,
    grade: `${p.gender} ${gradeName(p.grade)}`,
    org: p.org,
    program: p.program,
    team: p.team_id ? { name: p.team ?? "", ...teams.get(p.team_id)! } : null,
  }));
}

async function teamOf(deps: Pick<Deps, "pool" | "now">, teamId: string, today: string): Promise<Omit<FoundTeam, "name">> {
  const [staff, games, practices, own] = await Promise.all([
    deps.pool.query<{ role: string; name: string; cell: string }>(
      `select s.role, u.first_name || ' ' || u.last_name as name, u.cell
         from team_staff s join users u on u.coach_id = s.coach_id where s.team_id = $1
        order by array_position(array['HeadCoach', 'AsstCoach', 'Manager', 'TeamParent'], s.role), lower(u.last_name)`,
      [teamId],
    ),
    deps.pool
      .query<{ id: string }>("select id::text from scenic_teams where thunder_team_id = $1", [teamId])
      .then(async (x) => {
        const copy = x.rows[0]?.id;
        return copy ? ((await scheduledGames(deps.pool, [copy]))[copy] ?? []) : [];
      }),
    upcomingForTeam(deps, teamId, 6),
    upcomingOwnPractices(deps, { org: "thunder", teamId }, 6),
  ]);
  return {
    staff: staff.rows.map((s) => ({ ...s, role: ROLE[s.role] ?? s.role })),
    games: games.filter((g) => g.published && g.date >= today),
    practices,
    own,
  };
}
