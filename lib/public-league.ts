// Public League page (SPEC.md section 13): no login. Scenic City's Leagues with their Teams and, once a Director of
// Programs publishes it, the Schedule. No contact information: team names, grades, levels, organizations' abbreviations,
// game dates, times, gyms and courts only. Simulated (DEV) teams and teams sitting out are left out.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { clubAbbr } from "./scenic-club-teams";
import { orgHasArea } from "./org-admin";
import { PLACE_SQL } from "./scenic-games";
import { directionsUrl } from "./directions";
import { PROGRAM_LOGO_SQL } from "./scenic-programs";
import { gradeLabel } from "./scenic-teams";
import type { Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const NOT_DEV = "t.name not like '%(DEV)'";

export type PublicLeagueSummary = {
  id: string;
  kind: string; // League, Circuit or Tournament
  name: string;
  startsOn: string;
  endsOn: string;
  published: boolean;
  logo: string | null;
  regCloses: string;
  registering: boolean; // registration still open (closes today or later)
  recLimited: boolean; // REC open only to the organizations Scenic City picked
};

// Programs (Leagues, Circuits, Tournaments) whose registration has opened and that ended no more than 30 days ago,
// soonest first: the login page's Programs list.
// `org`: only that organization's (its main page); left out: every organization's (the public League page).
export async function publicPrograms(q: Pick<Queryable, "query">, now: Date, org?: string): Promise<PublicLeagueSummary[]> {
  const r = await q.query<PublicLeagueSummary>(
    `select id::text, kind, name, starts_on::text as "startsOn", ends_on::text as "endsOn",
            schedule_published_at is not null as published, ${PROGRAM_LOGO_SQL} as logo,
            reg_closes::text as "regCloses", reg_closes >= $1::date as registering,
            rec_limited_by is not null as "recLimited"
       from scenic_programs p
      where reg_opens <= $1::date and ends_on >= $1::date - 30 and ($2::text is null or p.org = $2)
      order by starts_on, lower(name)`,
    [easternDate(now), org ?? null],
  );
  return r.rows;
}

// Just the Leagues (the public League page).
export async function publicLeagues(q: Pick<Queryable, "query">, now: Date): Promise<PublicLeagueSummary[]> {
  return (await publicPrograms(q, now)).filter((p) => p.kind === "League");
}

export type PublicTeam = { id: string; name: string; tag: string }; // tag: an organization's or club's abbreviation, or "Solo"
export type PublicGroup = { label: string; teams: PublicTeam[] }; // "5th Boys COMP"
export type PublicGame = {
  starts: string | null; // "HH:MM" Eastern, once placed
  gym: string | null;
  court: string | null;
  map: string | null; // Directions to the gym
  group: string;
  home: string; // "TBD" when there's no opponent yet
  away: string;
  homeId: string | null; // the teams' ids (a device follows teams by id)
  awayId: string | null;
};
export type PublicDay = { date: string; games: PublicGame[] };

export type PublicLeague = PublicLeagueSummary & { groups: PublicGroup[]; schedule: PublicDay[] | null }; // null: not published

const groupLabel = (grade: number, gender: string, level: string) => `${gradeLabel(grade, grade)} ${gender} ${level}`;

export async function publicLeague(q: Pick<Queryable, "query">, now: Date, id: unknown, org?: string): Promise<PublicLeague | null> {
  if (!isId(id)) return null;
  const league = (await publicPrograms(q, now, org)).find((l) => l.id === id);
  if (!league) return null;
  const teams = await q.query<{
    id: string;
    name: string;
    grade: number;
    gender: string;
    level: string;
    partner: string | null;
    abbr: string | null;
    solo: boolean | null;
  }>(
    `select t.id::text, t.name, g.grade, d.gender, g.level, p.name as partner, coalesce(og.abbr, p.abbr) as abbr, og.kind = 'Team' as solo
       from scenic_registrations r
       join scenic_teams t on t.id = r.team_id
       join scenic_pools po on po.id = r.pool_id
       join scenic_grade_groups g on g.id = po.group_id
       join scenic_divisions d on d.id = g.division_id
       left join partners p on p.id = t.partner_id
       left join organizations og on og.slug = p.org_slug
      where r.program_id = $1 and r.removed_by is null and ${NOT_DEV}
      order by d.grade_low = -1 desc, d.gender, g.grade, g.level desc, lower(t.name)`,
    [id],
  );
  const groups: PublicGroup[] = [];
  for (const t of teams.rows) {
    const label = groupLabel(t.grade, t.gender, t.level);
    let g = groups.at(-1);
    if (g?.label !== label) groups.push((g = { label, teams: [] }));
    g.teams.push({ id: t.id, name: t.name, tag: t.partner && !t.solo ? (t.abbr ?? clubAbbr(t.partner)) : "Solo" });
  }
  // Only a League has a schedule, once published.
  if (league.kind !== "League" || !league.published) return { ...league, groups, schedule: null };

  const schedule = await programSchedule(q, id);
  return { ...league, groups, schedule };
}

// A League's games by day (date, time, gym, court, group, home and away; DEV teams left out), for the public page once
// published, and for Scenic City's own program page at any time (past programs too).
export async function programSchedule(q: Pick<Queryable, "query">, id: string): Promise<PublicDay[]> {
  const games = await q.query<{
    date: string;
    starts: string | null;
    gym: string | null;
    court: string | null;
    map_lat: number | null;
    map_lng: number | null;
    map_place: string | null;
    grade: number;
    gender: string;
    level: string;
    a: string;
    b: string | null;
    a_id: string;
    b_id: string | null;
    home_side: string | null;
  }>(
    `select m.day::text as date, to_char(m.starts, 'HH24:MI') as starts, place.gym, place.court,
            place.map_lat, place.map_lng, place.map_place, g.grade, d.gender, g.level, ta.name as a, tb.name as b, ta.id::text as a_id, tb.id::text as b_id, m.home_side
       from scenic_matchups m
       join scenic_teams ta on ta.id = m.team_a
       left join scenic_teams tb on tb.id = m.team_b
       join scenic_registrations r on r.program_id = m.program_id and r.team_id = m.team_a
       join scenic_pools po on po.id = r.pool_id
       join scenic_grade_groups g on g.id = po.group_id
       join scenic_divisions d on d.id = g.division_id
       ${PLACE_SQL}
      where m.program_id = $1 and ta.name not like '%(DEV)' and coalesce(tb.name, '') not like '%(DEV)'
      order by m.day, m.starts nulls last, lower(place.gym), lower(place.court), g.grade, lower(ta.name)`,
    [id],
  );
  const schedule: PublicDay[] = [];
  for (const m of games.rows) {
    let day = schedule.at(-1);
    if (day?.date !== m.date) schedule.push((day = { date: m.date, games: [] }));
    const b = m.b ?? "TBD";
    const aHome = (m.home_side ?? "a") === "a";
    day.games.push({
      starts: m.starts,
      gym: m.gym,
      court: m.court,
      map: directionsUrl(m.map_lat, m.map_lng, m.map_place),
      group: groupLabel(m.grade, m.gender, m.level),
      home: aHome ? m.a : b,
      away: aHome ? b : m.a,
      homeId: aHome ? m.a_id : m.b_id,
      awayId: aHome ? m.b_id : m.a_id,
    });
  }
  return schedule;
}

// A device's followed teams (My Teams on the login page; no login, the ids are kept on the device): each team's name, its
// roster as public names (first name and last initial, jersey), and for every program on the public list it's in, its
// group and (a published League) all its games. Unknown ids, simulated (DEV) teams and anything past MAX_FOLLOWED are
// dropped.
export const MAX_FOLLOWED = 30;
export type FollowedGame = {
  date: string;
  starts: string | null;
  gym: string | null;
  court: string | null;
  map: string | null; // Directions to the gym
  opponent: string;
  home: boolean;
};
export type FollowedProgram = { id: string; name: string; group: string; games: FollowedGame[] | null }; // null: no schedule posted
export type PublicPlayer = { name: string; jersey: string | null }; // "Ava L."
// roster null: the team keeps no roster in the app (a Solo team).
export type FollowedTeam = { id: string; name: string; roster: PublicPlayer[] | null; programs: FollowedProgram[] };

const publicName = (first: string, last: string) => `${first.trim()} ${last.trim().charAt(0).toUpperCase()}.`.trim();

export async function followedTeams(q: Pick<Queryable, "query">, now: Date, ids: unknown, org?: string): Promise<FollowedTeam[]> {
  const list = [...new Set(Array.isArray(ids) ? ids.filter(isId) : [])].slice(0, MAX_FOLLOWED);
  if (!list.length) return [];
  const names = await q.query<{ id: string; name: string; keeps: boolean }>(
    `select t.id::text, t.name, (t.thunder_team_id is not null or t.org_team_id is not null) as keeps
       from scenic_teams t where t.id = any($1::bigint[]) and ${NOT_DEV}`,
    [list],
  );
  const teams = new Map<string, FollowedTeam>(
    names.rows.map((t) => [t.id, { id: t.id, name: t.name, roster: t.keeps ? [] : null, programs: [] }]),
  );
  if (!teams.size) return [];
  // Rosters: a Thunder team's players, or an organization's team's (typed in or imported).
  const players = await q.query<{ team: string; first: string; last: string; jersey: string | null }>(
    `select t.id::text as team, p.first_name as first, p.last_name as last, null::text as jersey
       from scenic_teams t join team_players p on p.team_id = t.thunder_team_id where t.id = any($1::bigint[])
     union all
     select t.id::text, p.first_name, p.last_name, p.jersey
       from scenic_teams t join org_team_players p on p.team_id = t.org_team_id where t.id = any($1::bigint[])
     order by 1, 2, 3`,
    [[...teams.keys()]],
  );
  for (const p of players.rows)
    teams.get(p.team)?.roster?.push({ name: publicName(p.first, p.last), jersey: p.jersey });
  const programs = await publicPrograms(q, now, org);
  const regs = await q.query<{ team: string; program: string; grade: number; gender: string; level: string }>(
    `select r.team_id::text as team, r.program_id::text as program, g.grade, d.gender, g.level
       from scenic_registrations r
       join scenic_pools po on po.id = r.pool_id
       join scenic_grade_groups g on g.id = po.group_id
       join scenic_divisions d on d.id = g.division_id
      where r.team_id = any($1::bigint[]) and r.program_id = any($2::bigint[]) and r.removed_by is null`,
    [[...teams.keys()], programs.map((p) => p.id)],
  );
  const schedules = new Map<string, PublicDay[]>();
  for (const p of programs) {
    const mine = regs.rows.filter((r) => r.program === p.id);
    if (!mine.length) continue;
    const scheduled = p.kind === "League" && p.published;
    if (scheduled && !schedules.has(p.id)) schedules.set(p.id, await programSchedule(q, p.id));
    for (const r of mine) {
      let games: FollowedGame[] | null = null;
      if (scheduled) {
        games = [];
        for (const d of schedules.get(p.id)!) {
          for (const g of d.games) {
            const home = g.homeId === r.team;
            if (!home && g.awayId !== r.team) continue;
            games.push({ date: d.date, starts: g.starts, gym: g.gym, court: g.court, map: g.map, opponent: home ? g.away : g.home, home });
          }
        }
      }
      teams.get(r.team)!.programs.push({ id: p.id, name: p.name, group: groupLabel(r.grade, r.gender, r.level), games });
    }
  }
  // In the order the device followed them.
  return list.flatMap((id) => teams.get(id) ?? []);
}

// A Director of Programs or of Scheduling (on the Scheduler) publishes a League's schedule to the public page, or takes it back.
export async function setSchedulePublished(deps: Deps, viewer: SessionUser, programId: unknown, on: boolean): Promise<Result> {
  if (!isId(programId)) return { ok: false, message: "Pick a League." };
  if (!(await canPublish(deps.pool, viewer)))
    return { ok: false, message: "Only a Scenic City Director of Programs or Scheduling can do that." };
  const r = await deps.pool.query(
    `update scenic_programs set schedule_published_by = $2, schedule_published_at = $3 where id = $1 and kind = 'League'`,
    [programId, on ? by(viewer) : null, on ? deps.now() : null],
  );
  return r.rowCount ? { ok: true } : { ok: false, message: "That League isn't there." };
}

export const canPublish = (q: Pick<Queryable, "query">, viewer: SessionUser) =>
  orgHasArea(q, viewer.coachId, "scenic-city", "programs", "scheduling");

// Whether a League's schedule is on the public page, and who published it (the Scheduler).
export async function schedulePublished(q: Pick<Queryable, "query">, programId: string): Promise<{ by: string } | null> {
  const r = await q.query<{ by: string }>(
    "select schedule_published_by as by from scenic_programs where id = $1 and schedule_published_at is not null",
    [programId],
  );
  return r.rows[0] ?? null;
}
