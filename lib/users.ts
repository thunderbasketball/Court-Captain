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
  joinReason: string | null; // why they asked to join, e.g. "Team staff: Asst Coach · 4G Epps", "Other: …"
  joinTeamListed: boolean; // a team staff request for a listed team (one tap to approve onto it)
};

// Admins (Members → Staff) and Directors of Coaches (Members → Coaches). Sorted by last name, then first name.
export async function listUsers(viewer: SessionUser): Promise<UserListItem[]> {
  if (!isThunderAdmin(viewer) && !hasArea(viewer, "teams")) throw new Error("Director only");
  const r = await db.query<UserListItem>(
    `select coach_id as "coachId", first_name as "firstName", last_name as "lastName", cell, email,
            (email is not null and lower(trim(email)) = lower(trim(coalesce(verified_email, '')))) as verified,
            active, has_role(coach_id, 'thunder', 'Request') as request, has_role(coach_id, 'thunder', 'Coach') as coach,
            has_role(coach_id, 'thunder', 'Director') as director,
            coalesce((select array_agg(t.name || ' · ' || case s.role when 'HeadCoach' then 'Head Coach' when 'AsstCoach' then 'Asst Coach'
                                                     when 'Manager' then 'Manager' else 'Team Parent' end order by t.name)
                      from team_staff s join teams t on t.id = s.team_id where s.coach_id = users.coach_id), '{}') as teams,
            exists (select 1 from org_roles o where o.coach_id = users.coach_id and o.org = 'scenic-city') as "scenicCity",
            updated_by as "updatedBy",
            (select case j.purpose
                      when 'staff' then 'Team staff: ' || case j.staff_role when 'HeadCoach' then 'Head Coach' when 'AsstCoach' then 'Asst Coach'
                                                       when 'Manager' then 'Team Manager' else 'Team Parent' end
                                    || ' · ' || coalesce(t.name, j.team_text || ' (not listed)')
                      else 'Other: ' || j.notes end
             from join_reasons j left join teams t on t.id = j.team_id where j.coach_id = users.coach_id) as "joinReason",
            exists (select 1 from join_reasons j where j.coach_id = users.coach_id and j.purpose = 'staff' and j.team_id is not null) as "joinTeamListed"
     from users
     -- Thunder's people only: a Thunder role (a request too) or a place on a Thunder team; not people who only belong
     -- to another organization.
     where exists (select 1 from org_roles o where o.coach_id = users.coach_id and o.org = 'thunder')
        or exists (select 1 from team_staff s where s.coach_id = users.coach_id)
     order by lower(last_name), lower(first_name)`,
  );
  return r.rows;
}
