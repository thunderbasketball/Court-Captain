// Home's 🔍 search (SPEC.md section 10): an organization's Owners, Admins and Directors find anything in it. Each word
// typed may be any part of: a coach's name, cell (partial numbers, typed any way) or email; a player's name, parents'
// names, cells and emails, address and other registration details; or a team, gym, program, session or scrimmage.
// Coaches: anyone with a role in the organization or coaching one of its teams. Players: Thunder's registrations (with
// their parents), another organization's team rosters. Scenic City has no players of its own.
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
// Everything else: a team, gym, program, session or scrimmage, with its page.
export type ThingHit = { key: string; kind: string; name: string; detail: string; href: string };
export type SearchResult = { coaches: CoachHit[]; players: PlayerHit[]; things: ThingHit[] };

const LIMIT = 10;
const ROLE_LABEL: Record<string, string> = {
  HeadCoach: "Head Coach",
  AsstCoach: "Asst Coach",
  Manager: "Manager",
  TeamParent: "Team Parent",
};
const ORG_ROLES = ["Owner", "Admin", "Director", "Coach"];

// The words typed, each matched anywhere in what's searched ("jo sm" finds John Smith; "423 55" or "(423) 55" a cell).
// A word of only digits and phone punctuation is matched as its digits. Null when too short.
export function searchWords(q: unknown): string[] | null {
  if (typeof q !== "string" || q.length > 60) return null;
  const words = q
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (/^[\d()+.\-]+$/.test(w) && /\d/.test(w) ? w.replace(/\D/g, "") : w))
    .filter(Boolean)
    .slice(0, 6);
  if (!words.length || words.join("").length < 2) return null;
  return words.map((w) => "%" + w.replace(/[\\%_]/g, (c) => `\\${c}`) + "%");
}

// Each word must be somewhere in these fields ($1 is the words array). Cells are also matched as digits only.
const digits = (cell: string) => `regexp_replace(coalesce(${cell}, ''), '\\D', '', 'g')`;
const matches = (fields: string[], cells: string[] = []) =>
  `(select bool_and(lower(concat_ws(' ', ${[...fields, ...cells.map(digits)].join(", ")})) like w) from unnest($1::text[]) w)`;
const nameMatch = (first: string, last: string) => matches([first, last]);

// Null when the viewer isn't an Owner, Admin or Director of the organization (checked here, on the server).
export async function searchOrg(deps: Deps, viewer: SessionUser, org: unknown, q: unknown): Promise<SearchResult | null> {
  if (!isOrgSlug(org)) return null;
  const ok = await deps.pool.query<{ ok: boolean }>("select acts_as($1, $2, 'Director') as ok", [viewer.coachId, org]);
  if (!ok.rows[0].ok) return null;
  const words = searchWords(q);
  if (!words) return { coaches: [], players: [], things: [] };
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
     where u.active and ${matches(["u.first_name", "u.last_name", "u.email"], ["u.cell"])}
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
       where ${matches(
         [
           "g.first_name", "g.last_name", "g.parent1_first", "g.parent1_last", "g.parent1_email", "g.parent2_first",
           "g.parent2_last", "g.parent2_email", "g.address", "g.city", "g.zip", "g.uniform_number", "g.uniform_size",
           "g.coach_request", "g.notes", "t.name",
         ],
         ["g.parent1_cell", "g.parent2_cell"],
       )}
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
  return { coaches, players, things: await searchThings(deps, org, words) };
}

// Teams, gyms, programs, sessions and scrimmages whose name or place holds every word.
async function searchThings(deps: Deps, org: string, words: string[]): Promise<ThingHit[]> {
  const base = `/org/${org}`;
  const teams =
    org === "thunder"
      ? `select 'team' as kind, t.id::text as id, t.name, 'Team' as detail, '${base}/teams/' || t.id as href from teams t
          where ${matches(["t.name", "t.alt_name", "t.coach_first", "t.coach_last"])}`
      : org === "scenic-city"
        ? `select 'team' as kind, t.id::text as id, t.name, 'Team' as detail, '${base}/teams' as href from scenic_teams t
            where ${matches(["t.name", "t.alt_name", "t.coach_first", "t.coach_last"])}`
        : `select 'team' as kind, t.id::text as id, t.name, 'Team' as detail, '${base}/teams/' || t.id as href from org_teams t
            where t.org = $2 and ${matches(["t.name", "t.alt_name", "t.coach_first", "t.coach_last"])}`;
  const r = await deps.pool.query<ThingHit & { id: string }>(
    `select kind || ':' || id as key, kind, name, detail, href from (
       ${teams}
       union all
       select 'gym', g.id::text, g.name, coalesce(nullif(g.address, ''), 'Gym'),
              case when $2 = 'thunder' then '${base}/facilities/gyms' else '${base}/facilities' end
         from gyms g where g.org = $2 and g.active and ${matches(["g.name", "g.short_name", "g.address"])}
       union all
       select 'program', p.id::text, p.name, 'Program', '${base}' from player_programs p
        where p.org = $2 and ${matches(["p.name"])}
       union all
       select 'program', p.id::text, p.name, p.kind, '${base}' from scenic_programs p
        where p.org = $2 and ${matches(["p.name", "p.kind"])}
       union all
       select 'session', e.id::text, e.name, to_char(e.starts_at at time zone 'America/New_York', 'Mon FMDD, FMHH12:MI AM') ||
              coalesce(' · ' || nullif(e.location, ''), ''), '/events/' || e.id
         from events e where e.org = $2 and ${matches(["e.name", "e.location", "e.notes"])}
       union all
       select 'scrimmage', s.id::text,
              coalesce(s.home_name, (select name from teams where id = s.home_thunder_team_id), (select name from org_teams where id = s.home_org_team_id), 'TBD')
              || ' vs ' ||
              coalesce(s.away_name, (select name from teams where id = s.away_thunder_team_id), (select name from org_teams where id = s.away_org_team_id), 'TBD'),
              to_char(s.starts_at at time zone 'America/New_York', 'Mon FMDD, FMHH12:MI AM') || ' · ' || s.place, '${base}'
         from scrimmages s where s.org = $2 and ${matches([
           "s.place",
           "s.away_name",
           "s.home_name",
           "(select string_agg(name, ' ') from teams where id in (s.home_thunder_team_id, s.away_thunder_team_id))",
           "(select string_agg(name, ' ') from org_teams where id in (s.home_org_team_id, s.away_org_team_id))",
         ])}
     ) x order by array_position(array['team', 'program', 'session', 'scrimmage', 'gym'], kind), lower(name) limit 20`,
    [words, org],
  );
  return r.rows.map(({ key, kind, name, detail, href }) => ({ key, kind, name, detail, href }));
}
