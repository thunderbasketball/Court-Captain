// A registered organization's Members (SPEC.md section 14), listed like Thunder's: everyone with a role there (a request
// too) or a place on one of its teams, by last name. Its Admins see them all (Staff); Directors of Teams see the coaches.
import type { SessionUser } from "./auth/service";
import { isOrgAdmin, orgHasArea } from "./org-admin";
import { isOrgSlug } from "./orgs";
import type { Queryable } from "./sql";
import type { UserListItem } from "./users";

export async function listOrgMembers(
  q: Pick<Queryable, "query">,
  viewer: SessionUser,
  org: unknown,
): Promise<{ users: UserListItem[]; admin: boolean } | null> {
  if (!isOrgSlug(org) || org === "thunder") return null;
  const admin = await isOrgAdmin(q, viewer.coachId, org);
  if (!admin && !(await orgHasArea(q, viewer.coachId, org, "teams"))) return null;
  const r = await q.query<UserListItem>(
    `select u.coach_id as "coachId", u.first_name as "firstName", u.last_name as "lastName", u.cell, u.email,
            (u.email is not null and lower(trim(u.email)) = lower(trim(coalesce(u.verified_email, '')))) as verified,
            u.active, has_role(u.coach_id, $1, 'Request') as request, has_role(u.coach_id, $1, 'Coach') as coach,
            (has_role(u.coach_id, $1, 'Director') or has_role(u.coach_id, $1, 'Admin')) as director,
            coalesce((select array_agg(t.name || ' · ' || case c.role when 'HeadCoach' then 'Head Coach' else 'Asst Coach' end
                                       order by lower(t.name))
                      from org_team_coaches c join org_teams t on t.id = c.team_id
                      where c.coach_id = u.coach_id and t.org = $1), '{}') as teams,
            coalesce((select json_agg(json_build_object(
                               'id', t.id::text, 'gender', t.gender, 'grade', t.grade,
                               'label', t.name || ' · ' || case c.role when 'HeadCoach' then 'Head Coach' else 'Asst Coach' end)
                               order by lower(t.name))
                      from org_team_coaches c join org_teams t on t.id = c.team_id
                      where c.coach_id = u.coach_id and t.org = $1), '[]') as "teamLinks",
            false as "scenicCity", u.updated_by as "updatedBy", null as "joinReason", false as "joinTeamListed"
     from users u
     where (exists (select 1 from org_roles o where o.coach_id = u.coach_id and o.org = $1)
            or exists (select 1 from org_team_coaches c join org_teams t on t.id = c.team_id
                       where c.coach_id = u.coach_id and t.org = $1))
       and not exists (select 1 from platform_admins p where p.coach_id = u.coach_id) -- CourtCaptain staff stay in the background
     order by lower(u.last_name), lower(u.first_name)`,
    [org],
  );
  return { users: r.rows, admin };
}
