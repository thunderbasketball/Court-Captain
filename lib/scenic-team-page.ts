// A League team's own page (Scenic City's League teams: Solo teams and outside clubs' teams; SPEC.md section 13), laid
// out like every organization's team page: its card, Current Registrations (each event it's in, its dates and the
// Brackets, Paid, its games) with its Schedule requests, Next 10 days, Staff and Games. Who may open it: Scenic City's
// Directors of Teams, Owners and Admins, the team's coaches, its Solo owner, and its club's contacts (an organization's
// team, or Thunder's, also has its own team page there). Checked here, on the server.
import type { SessionUser } from "./auth/service";
import { isOrgAdmin, orgHasArea } from "./org-admin";
import type { ChoiceResult } from "./program-options";
import { TEAM_COACHES, leagueEntry } from "./scenic-programs";
import { gradeLabel } from "./scenic-teams";
import type { Queryable } from "./sql";
import { easternDate } from "./time";

const ORG = "scenic-city";
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

export type LeagueTeamPage = {
  team: {
    id: string;
    name: string;
    altName: string | null;
    gender: string;
    grades: string; // "5th Grade"
    level: string;
    from: string; // "Solo · Ethan Robinson", or its club
    createdBy: string;
  };
  head: { coachId: string; first: string; last: string; cell: string; email: string | null; verified: boolean } | null;
  staff: { role: string; first: string; last: string; cell: string; email: string | null }[]; // Assistant Coach, Team Manager…
  programs: {
    id: string;
    name: string;
    kind: string;
    division: string; // "Boys 4th–5th · 5th COMP"
    paid: boolean;
    out: boolean; // taken out by the League
    entry: (ChoiceResult & { allSeason: boolean }) | null; // a League's dates, GG and Brackets
  }[];
  manage: boolean; // a Director of Teams, Owner or Admin
};

// What a League team (or a Thunder or organization team's League copy) is in that hasn't ended: division, Paid, its dates.
// For pages that already checked the viewer may see the team.
export async function leaguePrograms(q: Pick<Queryable, "query">, id: string): Promise<LeagueTeamPage["programs"]> {
  const regs = await q.query<{ id: string; name: string; kind: string; division: string; paid: boolean; out: boolean }>(
      `select p.id::text, p.name, p.kind, r.paid, r.removed_by is not null as out,
              d.gender || ' ' || d.grade_low || '-' || d.grade_high || ' · ' || g.grade || ' ' || g.level as division
         from scenic_registrations r join scenic_programs p on p.id = r.program_id
         join scenic_pools po on po.id = r.pool_id join scenic_grade_groups g on g.id = po.group_id
         join scenic_divisions d on d.id = g.division_id
        where r.team_id = $1 and p.ends_on >= $2::date order by p.starts_on, lower(p.name)`,
      [id, easternDate(new Date())],
    );
  const programs: LeagueTeamPage["programs"] = [];
  for (const p of regs.rows) {
    const entry = p.kind === "League" ? (await leagueEntry(q, p.id, id)).entry : null;
    const [g, rest] = p.division.split(" · ");
    const [gender, span] = g.split(" ");
    const [lo, hi] = span.split("-").map(Number);
    const [grade, level] = rest.split(" ");
    programs.push({
      ...p,
      division: `${gender} ${gradeLabel(lo, hi).replace("/", "–")} · ${gradeLabel(Number(grade), Number(grade))} ${level}`,
      entry: entry && { perDate: entry.perDate, bracket: entry.bracket, feeCents: entry.feeCents, allSeason: entry.allSeason },
    });
  }
  return programs;
}

// The page's data, or null when the team isn't a League team or the viewer may not see it.
export async function leagueTeamPage(q: Pick<Queryable, "query">, viewer: SessionUser, id: unknown): Promise<LeagueTeamPage | null> {
  if (!isId(id)) return null;
  const r = await q.query<{
    id: string;
    name: string;
    alt_name: string | null;
    gender: string;
    grade_low: number;
    grade: number;
    level: string;
    partner_id: string | null;
    club: string | null;
    owner: string | null;
    owner_id: string | null;
    created_by: string;
    coach: boolean; // the viewer is one of its coaches
    contact: boolean; // the viewer is a contact of its club
  }>(
    `select t.id::text, t.name, t.alt_name, t.gender, t.grade_low, t.grade, t.level, t.partner_id::text, p.name as club,
            o.first_name || ' ' || o.last_name as owner, t.owner_coach_id as owner_id, t.created_by,
            exists (select 1 from json_array_elements(${TEAM_COACHES}) x(c) where x.c->>'key' = 'u:' || $2) as coach,
            (t.partner_id is not null and exists (select 1 from partner_contacts pc where pc.partner_id = t.partner_id and pc.coach_id = $2)) as contact
       from scenic_teams t left join partners p on p.id = t.partner_id left join users o on o.coach_id = t.owner_coach_id
      where t.id = $1`,
    [id, viewer.coachId],
  );
  const t = r.rows[0];
  if (!t) return null;
  const manage = (await orgHasArea(q, viewer.coachId, ORG, "teams")) || (await isOrgAdmin(q, viewer.coachId, ORG));
  if (!manage && !t.coach && !t.contact && t.owner_id !== viewer.coachId) return null;

  const [head, staff, programs] = await Promise.all([
    q.query<NonNullable<LeagueTeamPage["head"]>>(
      `select u.coach_id as "coachId", u.first_name as first, u.last_name as last, u.cell, u.email,
              (u.verified_email is not null and lower(trim(u.verified_email)) = lower(trim(coalesce(u.email, '')))) as verified
         from scenic_teams t join users u on u.coach_id = t.coach_id where t.id = $1`,
      [id],
    ),
    q.query<LeagueTeamPage["staff"][number]>(
      `select role, first_name as first, last_name as last, cell, email from scenic_team_staff where team_id = $1
        order by array_position(array['AsstCoach', 'Manager', 'TeamParent'], role)`,
      [id],
    ),
    leaguePrograms(q, id),
  ]);
  return {
    team: {
      id: t.id,
      name: t.name,
      altName: t.alt_name,
      gender: t.gender,
      grades: `${gradeLabel(t.grade_low, t.grade)} Grade`,
      level: t.level,
      from: t.club ?? (t.owner ? `Solo · ${t.owner}` : "Solo"),
      createdBy: t.created_by,
    },
    head: head.rows[0] ?? null,
    staff: staff.rows,
    programs,
    manage,
  };
}

// A League team's whole staff, read from where the team is kept: a Thunder team's from Thunder (team_staff), an
// organization's from it (org_team_coaches), a League team's (FastBreak, a club, Solo) its Head Coach and its other staff
// here. Head Coach first, then Assistant Coach, Manager, Team Parent. `coachId` only for people with a login (👁, chat);
// `verified`: their email is confirmed (the green ✓). By League team id.
export type LeagueStaffMember = {
  coachId: string | null;
  role: "HeadCoach" | "AsstCoach" | "Manager" | "TeamParent";
  first: string;
  last: string;
  cell: string;
  email: string | null;
  verified: boolean;
};
const VERIFIED = `(u.verified_email is not null and lower(trim(u.verified_email)) = lower(trim(coalesce(u.email, ''))))`;
export async function leagueStaff(q: Pick<Queryable, "query">, ids: string[]): Promise<Record<string, LeagueStaffMember[]>> {
  if (!ids.length) return {};
  const r = await q.query<LeagueStaffMember & { team: string }>(
    `select st.id::text as team, u.coach_id as "coachId", s.role, u.first_name as first, u.last_name as last, u.cell, u.email, ${VERIFIED} as verified
       from scenic_teams st join team_staff s on s.team_id = st.thunder_team_id join users u on u.coach_id = s.coach_id
      where st.id = any($1::bigint[])
     union all
     select st.id::text, u.coach_id, c.role, u.first_name, u.last_name, u.cell, u.email, ${VERIFIED}
       from scenic_teams st join org_team_coaches c on c.team_id = st.org_team_id join users u on u.coach_id = c.coach_id
      where st.id = any($1::bigint[])
     union all
     select st.id::text, u.coach_id, 'HeadCoach', u.first_name, u.last_name, u.cell, u.email, ${VERIFIED}
       from scenic_teams st join users u on u.coach_id = st.coach_id
      where st.id = any($1::bigint[]) and st.org_team_id is null and st.thunder_team_id is null
     union all
     select st.id::text, u.coach_id, s.role, s.first_name, s.last_name, s.cell, coalesce(s.email, u.email), coalesce(${VERIFIED}, false)
       from scenic_teams st join scenic_team_staff s on s.team_id = st.id left join users u on u.coach_id = s.coach_id
      where st.id = any($1::bigint[]) and st.org_team_id is null and st.thunder_team_id is null`,
    [ids],
  );
  const order = ["HeadCoach", "AsstCoach", "Manager", "TeamParent"];
  const out: Record<string, LeagueStaffMember[]> = {};
  for (const { team, ...m } of r.rows) (out[team] ??= []).push(m);
  for (const list of Object.values(out))
    list.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.last.localeCompare(b.last));
  return out;
}

// A Scenic City coach's own League teams (Head Coach of, or Solo owner), by name: their Home is the first one's page.
export async function myLeagueTeams(q: Pick<Queryable, "query">, coachId: string): Promise<{ id: string; name: string }[]> {
  const r = await q.query<{ id: string; name: string }>(
    `select id::text, name from scenic_teams
      where (coach_id = $1 or owner_coach_id = $1
             or exists (select 1 from scenic_team_staff s where s.team_id = scenic_teams.id and s.coach_id = $1 and s.role = 'AsstCoach'))
        and org_team_id is null and thunder_team_id is null and name not like '%(DEV)'
      order by lower(name)`,
    [coachId],
  );
  return r.rows;
}
