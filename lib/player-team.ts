// What a Director sees from a player's 👁 button: the team they're rostered on, its staff and next practices.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import type { Role } from "./teams";
import { hasArea } from "./org-admin";

type Deps = { pool: Pool; now: () => Date };

export type PlayerTeam = {
  id: string;
  name: string;
  level: string;
  rosteredBy: string;
  rosteredAt: Date;
  staff: { role: Role; name: string; cell: string }[];
  practices: { at: Date; gym: string; court: string }[];
};

const NEXT_PRACTICES = 3;

// Director only. Null when the player isn't on a team.
export async function playerTeam(deps: Deps, viewer: SessionUser, registrantId: unknown): Promise<PlayerTeam | null> {
  if (!hasArea(viewer, "players", "teams")) throw new Error("Director only");
  if (typeof registrantId !== "string" || !/^[\w-]{1,40}$/.test(registrantId)) return null;
  const t = await deps.pool.query<Omit<PlayerTeam, "staff" | "practices">>(
    `select t.id::text, t.name, t.level, p.rostered_by as "rosteredBy", p.rostered_at as "rosteredAt"
     from team_players p join teams t on t.id = p.team_id where p.registrant_id = $1 order by t.name limit 1`,
    [registrantId],
  );
  if (!t.rows[0]) return null;
  const team = t.rows[0];
  const [staff, practices] = await Promise.all([
    deps.pool.query<PlayerTeam["staff"][number]>(
      `select s.role, u.first_name || ' ' || u.last_name as name, u.cell
       from team_staff s join users u on u.coach_id = s.coach_id where s.team_id = $1
       order by array_position(array['HeadCoach', 'AsstCoach', 'Manager', 'TeamParent'], s.role), lower(u.last_name)`,
      [team.id],
    ),
    deps.pool.query<PlayerTeam["practices"][number]>(
      `select s.starts_at as at, g.name as gym, c.name as court
       from slots s join courts c on c.id = s.court_id join gyms g on g.id = c.gym_id
       where s.team_id = $1 and s.starts_at >= $2 order by s.starts_at limit ${NEXT_PRACTICES}`,
      [team.id, deps.now()],
    ),
  ]);
  return { ...team, staff: staff.rows, practices: practices.rows };
}
