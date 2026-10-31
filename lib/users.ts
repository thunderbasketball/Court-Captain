import "server-only";
import { db } from "./db";
import type { SessionUser } from "./auth/service";
import { hasArea, isThunderAdmin } from "./org-admin";

export type UserListItem = {
  coachId: string;
  firstName: string;
  lastName: string;
  cell: string;
  email: string | null;
  verified: boolean;
  active: boolean;
  request: boolean;
  coach: boolean;
  director: boolean;
  teams: string[]; // e.g. "4G Epps · Manager", sorted by team name
  scenicCity: boolean; // Scenic City also uses this person
  updatedBy: string | null;
};

// Admins (Members → Staff) and Directors of Coaches (Members → Coaches). Sorted by last name, then first name.
export async function listUsers(viewer: SessionUser): Promise<UserListItem[]> {
  if (!isThunderAdmin(viewer) && !hasArea(viewer, "coaches")) throw new Error("Director only");
  const r = await db.query<UserListItem>(
    `select coach_id as "coachId", first_name as "firstName", last_name as "lastName", cell, email,
            (email is not null and lower(trim(email)) = lower(trim(coalesce(verified_email, '')))) as verified,
            active, has_role(coach_id, 'thunder', 'Request') as request, has_role(coach_id, 'thunder', 'Coach') as coach,
            has_role(coach_id, 'thunder', 'Director') as director,
            coalesce((select array_agg(t.name || ' · ' || case s.role when 'HeadCoach' then 'Head Coach' when 'AsstCoach' then 'Asst Coach'
                                                     when 'Manager' then 'Manager' else 'Team Parent' end order by t.name)
                      from team_staff s join teams t on t.id = s.team_id where s.coach_id = users.coach_id), '{}') as teams,
            exists (select 1 from org_roles o where o.coach_id = users.coach_id and o.org = 'scenic-city') as "scenicCity",
            updated_by as "updatedBy"
     from users
     order by lower(last_name), lower(first_name)`,
  );
  return r.rows;
}
