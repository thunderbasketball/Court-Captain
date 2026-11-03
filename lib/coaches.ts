import "server-only";
import { db } from "./db";
import type { SessionUser } from "./auth/service";
import { hasArea } from "./org-admin";

export type VolunteerCoach = {
  registrantId: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  cell: string | null;
  email: string | null;
  role: string;
  isHead: boolean;
  playerName: string;
  staff: string[]; // the team staff spots they already hold (matched by cell), e.g. "1B Clemons · Head Coach"
};

export type CoachGroup = { gender: "Boys" | "Girls"; grade: string; coaches: VolunteerCoach[] };

// Directors of Coaches (and Admins). Parents who answered "interested in coaching" at registration, with any team staff
// spots they already hold, grouped by their player's Gender, then Grade; Head Coach before Assistant, then by last name.
export async function listVolunteerCoaches(viewer: SessionUser): Promise<CoachGroup[]> {
  if (!hasArea(viewer, "teams")) throw new Error("Director only");
  const r = await db.query<VolunteerCoach & { gender: "Boys" | "Girls"; grade: string }>(
    `select registrant_id as "registrantId", gender, grade,
            nullif(trim(parent1_first), '') as "firstName", nullif(trim(parent1_last), '') as "lastName",
            parent1_cell as cell, parent1_email as email,
            coaching_interest as role, coaching_interest ilike 'head%' as "isHead",
            first_name || ' ' || last_name as "playerName",
            array(select t.name || ' · ' || case s.role when 'HeadCoach' then 'Head Coach' when 'AsstCoach' then 'Asst Coach'
                                                   when 'Manager' then 'Manager' else 'Team Parent' end
                  from users u join team_staff s on s.coach_id = u.coach_id join teams t on t.id = s.team_id
                  where u.cell = registrations.parent1_cell order by t.name) as staff
     from registrations
     where coaching_interest is not null
     order by gender, grade_sort, coaching_interest ilike 'head%' desc,
              lower(parent1_last), lower(parent1_first), lower(last_name), lower(first_name)`,
  );
  const groups: CoachGroup[] = [];
  for (const c of r.rows) {
    let g = groups.at(-1);
    if (!g || g.gender !== c.gender || g.grade !== c.grade) groups.push((g = { gender: c.gender, grade: c.grade, coaches: [] }));
    g.coaches.push(c);
  }
  return groups;
}
