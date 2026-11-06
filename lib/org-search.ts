// Home's 🔍 search (SPEC.md section 10): an organization's Owners, Admins and Directors find a coach or player by name.
// Coaches: anyone with a role in the organization or coaching one of its teams. Players: Thunder's registrations (with
// their parents), another organization's team rosters. Scenic City has no players of its own, so coaches only.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { gradeLabel } from "./grades";
import { isOrgAdmin } from "./org-admin";
import { isOrgSlug } from "./orgs";
import { parent, type Parent } from "./rosters";

type Deps = { pool: Pool };

export type TeamLink = { name: string; role: string; href: string };
export type CoachHit = {
  coachId: string;
  name: string;
  cell: string;
  email: string | null;
  roles: string[]; // organization roles (Owner, Admin, Director, Coach)
  teams: TeamLink[];
  dashboard: string | null; // their dashboard, for the organization's Owners and Admins
};
export type PlayerHit = { key: string; name: string; detail: string; team: TeamLink | null; parents: Parent[] };
export type SearchResult = { coaches: CoachHit[]; players: PlayerHit[] };

const LIMIT = 10;
const ROLE_LABEL: Record<string, string> = {
  HeadCoach: "Head Coach",
  AsstCoach: "Asst Coach",
  Manager: "Manager",
  TeamParent: "Team Parent",
};
const ORG_ROLES = ["Owner", "Admin", "Director", "Coach"];

// The words typed, each matched to the start of a first or last name ("jo sm" finds John Smith). Null when too short.
export function searchWords(q: unknown): string[] | null {
  if (typeof q !== "string") return null;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  if (!words.length || words.join("").length < 2 || q.length > 60) return null;
  return words.map((w) => w.replace(/[\\%_]/g, (c) => `\\${c}`) + "%");
}

// Each word must start the first or last name ($1 is the words array).
const nameMatch = (first: string, last: string) =>
  `(select bool_and(lower(${first}) like w or lower(${last}) like w) from unnest($1::text[]) w)`;

// Null when the viewer isn't an Owner, Admin or Director of the organization (checked here, on the server).
export async function searchOrg(deps: Deps, viewer: SessionUser, org: unknown, q: unknown): Promise<SearchResult | null> {
  if (!isOrgSlug(org)) return null;
  const ok = await deps.pool.query<{ ok: boolean }>("select acts_as($1, $2, 'Director') as ok", [viewer.coachId, org]);
  if (!ok.rows[0].ok) return null;
  const words = searchWords(q);
  if (!words) return { coaches: [], players: [] };
  const admin = await isOrgAdmin(deps.pool, viewer.coachId, org);

  // Their teams in this organization, by kind.
  const teamsSql =
    org === "thunder"
      ? `select t.name, s.role, '/org/thunder/teams/' || t.id as href from team_staff s join teams t on t.id = s.team_id
         where s.coach_id = u.coach_id`
      : org === "scenic-city"
        ? `select t.name, 'HeadCoach' as role, '/org/scenic-city/teams' as href from scenic_teams t where t.coach_id = u.coach_id`
        : `select t.name, c.role, '/org/' || t.org || '/teams/' || t.id as href from org_team_coaches c
           join org_teams t on t.id = c.team_id where c.coach_id = u.coach_id and t.org = $2`;
  const c = await deps.pool.query<Omit<CoachHit, "dashboard">>(
    `select u.coach_id as "coachId", u.first_name || ' ' || u.last_name as name, u.cell, u.email,
            array(select r.role from org_roles r where r.coach_id = u.coach_id and r.org = $2 and r.role = any($3::text[])
                  order by array_position($3::text[], r.role)) as roles,
            coalesce((select json_agg(x order by x.name) from (${teamsSql}) x), '[]') as teams
     from users u
     where u.active and ${nameMatch("u.first_name", "u.last_name")}
       and (exists (select 1 from org_roles r where r.coach_id = u.coach_id and r.org = $2 and r.role = any($3::text[]))
            or exists (${teamsSql}))
     order by lower(u.last_name), lower(u.first_name) limit ${LIMIT}`,
    [words, org, ORG_ROLES],
  );
  const coaches = c.rows.map((x) => ({
    ...x,
    teams: x.teams.map((t) => ({ ...t, role: ROLE_LABEL[t.role] ?? t.role })),
    dashboard: admin && x.coachId !== viewer.coachId ? `/me/${x.coachId}` : null,
  }));

  let players: PlayerHit[] = [];
  if (org === "thunder") {
    type Row = { key: string; name: string; gender: string; grade: string; team: string | null; teamId: string | null } & Record<
      `p${1 | 2}${"f" | "l" | "c" | "e"}`,
      string | null
    >;
    const p = await deps.pool.query<Row>(
      `select g.registrant_id as key, g.first_name || ' ' || g.last_name as name, g.gender, g.grade,
              t.name as team, t.id::text as "teamId",
              g.parent1_first as p1f, g.parent1_last as p1l, g.parent1_cell as p1c, g.parent1_email as p1e,
              g.parent2_first as p2f, g.parent2_last as p2l, g.parent2_cell as p2c, g.parent2_email as p2e
       from registrations g
       left join lateral (select t.id, t.name from team_players tp join teams t on t.id = tp.team_id
                          where tp.registrant_id = g.registrant_id order by t.name limit 1) t on true
       where ${nameMatch("g.first_name", "g.last_name")}
       order by lower(g.last_name), lower(g.first_name) limit ${LIMIT}`,
      [words],
    );
    players = p.rows.map((r) => ({
      key: r.key,
      name: r.name,
      detail: `${r.gender} · ${gradeLabel(r.grade)}`,
      team: r.teamId ? { name: r.team!, role: "", href: `/org/thunder/teams/${r.teamId}` } : null,
      parents: [parent(r.p1f, r.p1l, r.p1c, r.p1e), parent(r.p2f, r.p2l, r.p2c, r.p2e)].filter((v): v is Parent => !!v),
    }));
  } else if (org !== "scenic-city") {
    const p = await deps.pool.query<{ key: string; name: string; gender: string; grade: number; team: string; teamId: string }>(
      `select p.id::text as key, p.first_name || ' ' || p.last_name as name, t.gender, p.grade, t.name as team, t.id::text as "teamId"
       from org_team_players p join org_teams t on t.id = p.team_id
       where t.org = $2 and ${nameMatch("p.first_name", "p.last_name")}
       order by lower(p.last_name), lower(p.first_name), t.name limit ${LIMIT}`,
      [words, org],
    );
    players = p.rows.map((r) => ({
      key: r.key,
      name: r.name,
      detail: `${r.gender === "Coed" ? "Coed" : r.gender} · ${r.grade === -1 ? "Pre-K" : r.grade === 0 ? "Kindergarten" : gradeLabel(String(r.grade))}`,
      team: { name: r.team, role: "", href: `/org/${org}/teams/${r.teamId}` },
      parents: [],
    }));
  }
  return { coaches, players };
}
