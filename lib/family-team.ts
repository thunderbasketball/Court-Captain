// A parent's team view (an organization with CourtPlayers; SPEC.md section 15): once they've logged in and their email is
// verified, their cell on a player's registration connects them to each team that player is on. For each: their player's number
// and size, what's coming (✓ / ✗ by them), the whole schedule, the staff, and the roster as first names, last initials and
// numbers. Never other families' contacts. Connected each time from the registrations, so a change there shows at once.
import { upcomingForTeam, type TeamPractice } from "./practice/schedule";
import type { Deps } from "./auth/service";
import { rsvpsFor, type Rsvp } from "./event-attendance";
import { teamSoon } from "./public-league";
import { scheduledGames, type ScheduledGame } from "./scenic-games";
import { teamScrimmages, type TeamScrimmage } from "./scrimmages";
import { upcomingOwnPractices, type OwnPractice } from "./team-practices";

export type FamilyTeam = {
  id: string;
  name: string;
  gender: string;
  level: string;
  kids: { player: string; firstName: string; name: string; number: string | null; size: string | null }[]; // theirs on it
  staff: { role: string; name: string; cell: string }[];
  roster: { name: string; number: string | null }[]; // "Ava L."
  games: ScheduledGame[]; // published
  soon: string[];
  practices: TeamPractice[];
  own: OwnPractice[];
  scrims: TeamScrimmage[];
  rsvps: Record<string, Record<string, Rsvp>>;
};
type D = Pick<Deps, "pool" | "now">;
const ROLE: Record<string, string> = { HeadCoach: "Head Coach", AsstCoach: "Asst Coach", Manager: "Team Manager", TeamParent: "Team Parent" };

// Null: they aren't a parent on any registration. `verified` false: their email isn't confirmed yet, so nothing is shown.
export async function familyTeams(deps: D, coachId: string): Promise<{ verified: boolean; teams: FamilyTeam[] } | null> {
  const r = await deps.pool.query<{ verified: boolean; parent: boolean }>(
    `select (u.active and u.email is not null and lower(trim(u.email)) = lower(trim(coalesce(u.verified_email, '')))) as verified,
            exists (select 1 from registrations g where u.cell in (g.parent1_cell, g.parent2_cell)) as parent
       from users u where u.coach_id = $1`,
    [coachId],
  );
  if (!r.rows[0]?.parent) return null;
  if (!r.rows[0].verified) return { verified: false, teams: [] };
  const kids = await deps.pool.query<{ team: string; name: string; gender: string; level: string; player: string; first: string; last: string; number: string | null; size: string | null }>(
    `select t.id::text as team, t.name, t.gender, t.level, p.registrant_id as player, g.first_name as first, g.last_name as last, un.number, un.size
       from users u join registrations g on u.cell in (g.parent1_cell, g.parent2_cell)
       join team_players p on p.registrant_id = g.registrant_id join teams t on t.id = p.team_id
       left join team_uniforms un on un.team_id = p.team_id and un.registrant_id = p.registrant_id
      where u.coach_id = $1
      order by lower(p.first_name), t.grade_sort, lower(t.name)`,
    [coachId],
  );
  const ids = [...new Set(kids.rows.map((k) => k.team))];
  return {
    verified: true,
    teams: await Promise.all(
      ids.map(async (id) => {
        const mine = kids.rows.filter((k) => k.team === id);
        return { id, name: mine[0].name, gender: mine[0].gender, level: mine[0].level, kids: mine.map((k) => ({ player: k.player, firstName: k.first, name: `${k.first} ${k.last}`, number: k.number, size: k.size })), ...(await teamDetails(deps, id, mine.map((k) => k.player))) };
      }),
    ),
  };
}

async function teamDetails(deps: D, id: string, players: string[]): Promise<Omit<FamilyTeam, "id" | "name" | "gender" | "level" | "kids">> {
  const ref = { org: "thunder", teamId: id };
  const [staff, roster, league, practices, own, scrims] = await Promise.all([
    deps.pool.query<{ role: string; name: string; cell: string }>(
      `select s.role, u.first_name || ' ' || u.last_name as name, u.cell from team_staff s join users u on u.coach_id = s.coach_id where s.team_id = $1
        order by array_position(array['HeadCoach', 'AsstCoach', 'Manager', 'TeamParent'], s.role), lower(u.last_name)`,
      [id],
    ),
    deps.pool.query<{ first: string; last: string; number: string | null }>(
      `select p.first_name as first, p.last_name as last, u.number from team_players p
         left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
        where p.team_id = $1 order by (case when u.number ~ '^[0-9]+$' then u.number::int end) nulls last, lower(p.first_name)`,
      [id],
    ),
    deps.pool.query<{ id: string }>("select id::text from scenic_teams where thunder_team_id = $1", [id]).then(async (x) => {
      const copy = x.rows[0]?.id;
      return copy ? { games: ((await scheduledGames(deps.pool, [copy]))[copy] ?? []).filter((g) => g.published), soon: await teamSoon(deps.pool, copy, deps.now()) } : { games: [], soon: [] };
    }),
    upcomingForTeam(deps as Deps, id, 60),
    upcomingOwnPractices(deps as Deps, ref, 60),
    teamScrimmages(deps as Deps, "thunder", [id]).then((x) => x[id] ?? []),
  ]);
  const rsvps = await rsvpsFor(
    deps.pool,
    ref,
    [
      ...practices.map((p) => ({ kind: "slot" as const, id: p.id })),
      ...own.map((p) => ({ kind: "own" as const, id: p.id })),
      ...league.games.map((g) => ({ kind: "game" as const, id: g.id })),
      ...scrims.map((x) => ({ kind: "scrimmage" as const, id: x.id })),
    ],
    players,
  );
  return {
    staff: staff.rows.map((s) => ({ ...s, role: ROLE[s.role] ?? s.role })),
    roster: roster.rows.map((p) => ({ name: `${p.first.trim()} ${p.last.trim().charAt(0).toUpperCase()}.`, number: p.number })),
    games: league.games,
    soon: league.soon,
    practices,
    own,
    scrims,
    rsvps,
  };
}
