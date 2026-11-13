import "server-only";
import { db } from "./db";
import { familyOf, type Family } from "./families";
import { AREAS } from "./org-admin";
import { myOfficiating, type MyOfficiatingGame } from "./officiating-schedule";

// My dashboard (SPEC.md section 15): one person's own information, players and team ties, across organizations.
export type MyDashboard = {
  name: string;
  cell: string;
  email: string | null;
  verified: boolean;
  roles: { org: string; labels: string[] }[]; // one row per organization, e.g. { org: "Thunder", labels: ["Owner · every area", "Coach"] }
  family: Family | null;
  teams: { id: string; name: string; role: string; next: Date | null; gym: string | null }[]; // Thunder team spots
  scenicTeams: { name: string; how: string }[]; // Scenic City teams they coach or run
  partners: string[]; // Scenic City partners they're a contact for
  officiating: MyOfficiatingGame[]; // coming games they're on as a referee
};

const ROLE: Record<string, string> = {
  HeadCoach: "Head Coach",
  AsstCoach: "Asst Coach",
  Manager: "Team Manager",
  TeamParent: "Team Parent",
};
const ORG: Record<string, string> = { thunder: "Thunder", "scenic-city": "Scenic City" };

// `coachId`: the viewer's own, or (checked by the page) someone an Admin may see.
export async function myDashboard(coachId: string): Promise<MyDashboard | null> {
  const id = coachId;
  const [u, roles, areas, admin, teams, scenicTeams, partners, family] = await Promise.all([
    db.query<{ name: string; cell: string; email: string | null; verified: boolean }>(
      `select first_name || ' ' || last_name as name, cell, email,
              (email is not null and lower(trim(email)) = lower(trim(coalesce(verified_email, '')))) as verified
       from users where coach_id = $1`,
      [id],
    ),
    db.query<{ org: string; name: string; role: string }>(
      `select r.org, coalesce(o.short_name, o.name) as name, r.role from org_roles r join organizations o on o.slug = r.org
       where r.coach_id = $1 and r.role <> 'Request' and r.role <> 'Partner'
       order by array_position(array['thunder', 'scenic-city'], r.org) nulls last, lower(o.short_name)`,
      [id],
    ),
    db.query<{ org: string; area: string }>("select org, area from director_areas where coach_id = $1", [id]),
    db.query<{ role: string }>("select role from platform_admins where coach_id = $1", [id]),
    db.query<{ id: string; name: string; role: string; next: Date | null; gym: string | null }>(
      `select t.id::text, t.name, s.role,
              (select min(x.starts_at) from slots x where x.team_id = t.id and x.starts_at > now()) as next,
              (select g.name from slots x join courts c on c.id = x.court_id join gyms g on g.id = c.gym_id
               where x.team_id = t.id and x.starts_at > now() order by x.starts_at limit 1) as gym
       from team_staff s join teams t on t.id = s.team_id where s.coach_id = $1
       order by t.grade_sort, t.name, array_position(array['HeadCoach','AsstCoach','Manager','TeamParent'], s.role)`,
      [id],
    ),
    db.query<{ name: string; how: string }>(
      `select t.name, case when t.coach_id = $1 then 'Coach' else 'Your Solo team' end as how
       from scenic_teams t where t.coach_id = $1 or t.owner_coach_id = $1 order by t.grade, t.name`,
      [id],
    ),
    db.query<{ name: string }>(
      "select p.name from partner_contacts c join partners p on p.id = c.partner_id where c.coach_id = $1 order by lower(p.name)",
      [id],
    ),
    familyOf(id),
  ]);
  // Officials groups they referee for, with their level.
  const officials = await db.query<{ org: string; name: string; level: string | null }>(
    `select f.org, coalesce(o.short_name, o.name) as name, f.level from org_officials f join organizations o on o.slug = f.org
     where f.coach_id = $1 order by lower(o.name)`,
    [id],
  );

  // One row per organization, its roles highest first: Owner, Admin, Director (with areas), Solo, Coach, Family.
  const order = ["Owner", "Admin", "Director", "Solo", "Coach", "Family"];
  const list: MyDashboard["roles"] = [];
  if (admin.rows[0]) list.push({ org: "CourtCaptain", labels: [`CourtCaptain ${admin.rows[0].role}`] });
  for (const org of [...new Set(roles.rows.map((r) => r.org))]) {
    const mine = roles.rows.filter((r) => r.org === org).map((r) => r.role);
    const top = mine.includes("Owner") ? "Owner" : mine.includes("Admin") ? "Admin" : null;
    const labels: string[] = [];
    for (const role of order) {
      if (!mine.includes(role)) continue;
      if (top && (role === "Admin" || role === "Director") && role !== top) continue; // Owners and Admins are also Directors
      if (role === "Director" && !top) {
        const names = areas.rows.filter((a) => a.org === org).flatMap((a) => AREAS.find((x) => x.key === a.area)?.name ?? []);
        labels.push(...(names.length ? names.map((n) => `Director of ${n}`) : ["Director (no areas yet)"]));
        continue;
      }
      labels.push(role === top ? `${role} · every area` : role);
    }
    if (labels.length) list.push({ org: ORG[org] ?? roles.rows.find((r) => r.org === org)!.name, labels });
  }
  for (const f of officials.rows) {
    const label = `Official · ${f.level ?? "level not set"}`;
    const name = ORG[f.org] ?? f.name;
    const row = list.find((r) => r.org === name);
    if (row) row.labels.push(label);
    else list.push({ org: name, labels: [label] });
  }

  const me = u.rows[0];
  if (!me) return null;
  return {
    name: me.name,
    cell: me.cell,
    email: me.email,
    verified: me.verified,
    roles: list,
    family,
    teams: teams.rows.map((t) => ({ ...t, role: ROLE[t.role] ?? t.role })),
    scenicTeams: scenicTeams.rows,
    partners: partners.rows.map((p) => p.name),
    officiating: await myOfficiating({ pool: db, now: () => new Date() }, id),
  };
}
