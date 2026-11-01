// Scenic City Members (SPEC.md section 13): the hosting sites' Owners and Admins, and the coaches in each program.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { listDirectors, orgHasArea } from "./org-admin";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
const ORG = "scenic-city";
type Person = { id: string; name: string; cell: string };

// Members → Hosting Sites (Admins and Directors of Facilities): each approved hosting site, by name, with the people who
// run it: an organization's Owners and Admins (CourtCaptain staff stay hidden), or a school's contacts.
export async function hostingSiteStaff(
  deps: Deps,
  viewer: SessionUser,
): Promise<{ id: string; name: string; org: string | null; people: (Person & { role: string })[] }[] | null> {
  if (!(await orgHasArea(deps.pool, viewer.coachId, ORG, "facilities"))) return null;
  const sites = await deps.pool.query<{ id: string; name: string; org: string | null }>(
    "select id::text, name, org_slug as org from partners where approved and hosts_games order by lower(name)",
  );
  return Promise.all(
    sites.rows.map(async (p) => {
      if (p.org) {
        const people = (await listDirectors(deps.pool, p.org))
          .filter((d) => d.admin)
          .map((d) => ({ id: d.id, name: d.name, cell: d.cell, role: d.owner ? "Owner" : "Admin" }));
        return { ...p, people };
      }
      const c = await deps.pool.query<Person>(
        `select u.coach_id as id, u.first_name || ' ' || u.last_name as name, u.cell
         from partner_contacts pc join users u using (coach_id) where pc.partner_id = $1
         order by lower(u.last_name), lower(u.first_name)`,
        [p.id],
      );
      return { ...p, people: c.rows.map((x) => ({ ...x, role: "Contact" })) };
    }),
  );
}

// Members → Coaches (Admins and Directors of Coaches, Teams or Programs): the active programs (for tabs), and the coaches
// of the teams registered in one of them (by last name), each with their teams and where those are from.
export async function programCoaches(
  deps: Deps,
  viewer: SessionUser,
  programId: string | null,
): Promise<{
  programs: { id: string; name: string }[];
  current: string | null;
  coaches: (Person & { teams: { name: string; from: string }[] })[];
  noCoach: { name: string; from: string }[]; // registered teams with no coach yet
} | null> {
  if (!(await orgHasArea(deps.pool, viewer.coachId, ORG, "coaches", "teams", "programs"))) return null;
  const programs = (
    await deps.pool.query<{ id: string; name: string }>(
      "select id::text, name from scenic_programs where ends_on >= $1::date order by starts_on, lower(name)",
      [easternDate(deps.now())],
    )
  ).rows;
  const current = programs.find((p) => p.id === programId)?.id ?? programs[0]?.id ?? null;
  if (!current) return { programs, current, coaches: [], noCoach: [] };
  const r = await deps.pool.query<{ id: string | null; name: string | null; cell: string | null; team: string; from: string }>(
    `select u.coach_id as id, u.first_name || ' ' || u.last_name as name, u.cell, t.name as team,
            coalesce(p.name, 'Solo · ' || o.first_name || ' ' || o.last_name) as "from"
     from scenic_registrations r join scenic_teams t on t.id = r.team_id
     left join users u on u.coach_id = t.coach_id
     left join partners p on p.id = t.partner_id left join users o on o.coach_id = t.owner_coach_id
     where r.program_id = $1
     order by lower(u.last_name) nulls last, lower(u.first_name), lower(t.name)`,
    [current],
  );
  const coaches: (Person & { teams: { name: string; from: string }[] })[] = [];
  const noCoach: { name: string; from: string }[] = [];
  for (const x of r.rows) {
    if (!x.id) {
      noCoach.push({ name: x.team, from: x.from });
      continue;
    }
    const c = coaches.find((y) => y.id === x.id);
    if (c) c.teams.push({ name: x.team, from: x.from });
    else coaches.push({ id: x.id, name: x.name!, cell: x.cell!, teams: [{ name: x.team, from: x.from }] });
  }
  return { programs, current, coaches, noCoach };
}
