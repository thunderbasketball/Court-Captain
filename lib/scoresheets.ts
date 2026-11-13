// Printable scoresheets (SPEC.md section 13, Scheduler): one sheet per League game placed at a gym on a Game Day, by
// court then start time, filled in with the League, division, date, time, gym and court, Home and Away teams, their
// coaches and their rosters (jersey numbers when the team has them). For the Scheduler's Admins and Directors of
// Scheduling, and for an organization's own gyms its Admins and Directors of Facilities (Documents card). Read only.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasArea, orgHasArea } from "./org-admin";
import { managesOfficials } from "./officials";
import { orgInfo } from "./org-registry";
import { TZ } from "./time";
import { isScheduler } from "./scenic-programs";
import { gradeRange } from "./scenic-teams";

type Deps = { pool: Pool };

export type SheetPlayer = { jersey: string | null; name: string };
export type SheetTeam = { name: string; coach: string | null; players: SheetPlayer[] };
export type Scoresheet = {
  id: string;
  league: string;
  division: string; // "Boys 5th–6th"
  date: string; // YYYY-MM-DD
  starts: string; // "HH:MM" Eastern
  minutes: number;
  gym: string;
  court: string;
  address: string | null;
  home: SheetTeam | null; // null: TBD
  away: SheetTeam | null;
  brand?: { name: string; logo: string | null }; // an organization's own game (a scrimmage): its name and logo on top
  officials: string[]; // the game's assigned referees, by spot (League games get them once officials can be assigned to them)
};
export type GymScoresheets = { gym: string; host: string; date: string; sheets: Scoresheet[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GYM = /^[po]\d{1,18}$/; // the Grid's gym key: a partner's gym ("p12") or an organization's ("o39")

export async function gymScoresheets(deps: Deps, viewer: SessionUser, day: unknown, gymKey: unknown): Promise<GymScoresheets | null> {
  if (typeof day !== "string" || !DATE.test(day) || typeof gymKey !== "string" || !GYM.test(gymKey)) return null;
  const id = gymKey.slice(1);
  const partner = gymKey[0] === "p";
  if (!(await isScheduler(deps.pool, viewer))) {
    // The host's own staff: an organization's gym, its Admins and Directors of Facilities.
    const org = partner ? null : (await deps.pool.query<{ org: string }>("select org from gyms where id = $1", [id])).rows[0]?.org;
    if (!org || !(await orgHasArea(deps.pool, viewer.coachId, org, "facilities"))) return null;
  }
  const gym = (
    await deps.pool.query<{ name: string; host: string; address: string | null }>(
      partner
        ? `select g.name, p.name as host, g.address from partner_gyms g join partners p on p.id = g.partner_id where g.id = $1`
        : `select g.name, o.name as host, coalesce(g.address, g.pin_address) as address
             from gyms g join organizations o on o.slug = g.org where g.id = $1`,
      [id],
    )
  ).rows[0];
  if (!gym) return null;
  const games = await deps.pool.query<{
    id: string;
    league: string;
    gender: string;
    grade_low: number;
    grade_high: number;
    starts: string;
    minutes: number;
    court: string;
    home: string | null;
    away: string | null;
  }>(
    `select m.id::text, p.name as league, d.gender, d.grade_low, d.grade_high, to_char(m.starts, 'HH24:MI') as starts,
            coalesce(gd.minutes_override, p.game_minutes, 55) as minutes,
            ${partner ? "c.name" : "coalesce(c.name, 'Main')"} as court,
            (case when coalesce(m.home_side, 'a') = 'a' then m.team_a else m.team_b end)::text as home,
            (case when coalesce(m.home_side, 'a') = 'a' then m.team_b else m.team_a end)::text as away
       from scenic_matchups m
       join scenic_programs p on p.id = m.program_id
       join scenic_divisions d on d.id = m.division_id
       left join game_days gd on gd.day = m.day
       ${
         partner
           ? "join partner_courts c on m.court_key ~ '^[0-9]+$' and c.id = m.court_key::bigint and c.gym_id = $2"
           : "left join courts c on c.id::text = split_part(substr(m.court_key, 2), '-', 2)"
       }
      where m.day = $1::date and m.court_key is not null
        ${partner ? "" : "and m.court_key like 'o%' and split_part(substr(m.court_key, 2), '-', 1) = $2::text"}
      order by court, m.starts, m.id`,
    [day, id],
  );
  const teamIds = [...new Set(games.rows.flatMap((g) => [g.home, g.away].filter((x): x is string => !!x)))];
  const teams = new Map<string, SheetTeam>();
  if (teamIds.length) {
    const r = await deps.pool.query<{ id: string; name: string; coach: string | null; players: SheetPlayer[] }>(
      `select t.id::text, t.name, nullif(trim(coalesce(u.first_name, t.coach_first, '') || ' ' || coalesce(u.last_name, t.coach_last, '')), '') as coach,
              coalesce(
                (select json_agg(json_build_object('jersey', x.jersey, 'name', x.first_name || ' ' || x.last_name)
                                 order by nullif(x.jersey, '')::int nulls last, lower(x.last_name), lower(x.first_name))
                   from org_team_players x where x.team_id = t.org_team_id),
                (select json_agg(json_build_object('jersey', nullif(un.number, ''), 'name', x.first_name || ' ' || x.last_name)
                                 order by nullif(un.number, '')::int nulls last, lower(x.last_name), lower(x.first_name))
                   from team_players x left join team_uniforms un on un.team_id = x.team_id and un.registrant_id = x.registrant_id
                  where x.team_id = t.thunder_team_id),
                '[]') as players
         from scenic_teams t left join users u on u.coach_id = t.coach_id
        where t.id = any($1::bigint[])`,
      [teamIds],
    );
    for (const t of r.rows) teams.set(t.id, { name: t.name, coach: t.coach, players: t.players });
  }
  return {
    gym: gym.name,
    host: gym.host,
    date: day,
    sheets: games.rows.map((g) => ({
      id: g.id,
      league: g.league,
      division: `${g.gender} ${gradeRange(g.grade_low, g.grade_high)}`,
      date: day,
      starts: g.starts,
      minutes: g.minutes,
      gym: gym.name,
      court: g.court,
      address: gym.address,
      home: g.home ? (teams.get(g.home) ?? null) : null,
      away: g.away ? (teams.get(g.away) ?? null) : null,
      officials: [],
    })),
  };
}

// A scrimmage's scoresheet (the 🖨 on a program's scrimmage), branded with the organization's name and logo: its
// teams' rosters (its own teams; an outside team or TBD has lines to write in), the place, and the game's assigned
// referees. For the organization's Admins and Directors of Teams or Events, a playing team's Head Coach, and the
// officials group scheduling it.
export async function scrimmageScoresheet(deps: Deps, viewer: SessionUser, id: unknown): Promise<Scoresheet | null> {
  if (typeof id !== "string" || !/^\d{1,18}$/.test(id)) return null;
  const s = (
    await deps.pool.query<{
      org: string;
      officials_org: string | null;
      program: string;
      date: string;
      starts: string;
      minutes: number;
      place: string;
      address: string | null;
      home_t: string | null;
      home_o: string | null;
      home_name: string | null;
      away_t: string | null;
      away_o: string | null;
      away_name: string | null;
    }>(
      `select s.org, s.officials_org, p.name as program, to_char(s.starts_at at time zone $2, 'YYYY-MM-DD') as date,
              to_char(s.starts_at at time zone $2, 'HH24:MI') as starts, s.minutes, s.place,
              nullif(coalesce(g.address, g.pin_address), '') as address,
              s.home_thunder_team_id::text as home_t, s.home_org_team_id::text as home_o, s.home_name,
              s.away_thunder_team_id::text as away_t, s.away_org_team_id::text as away_o, s.away_name
         from scrimmages s join player_programs p on p.id = s.program_id left join gyms g on g.id = s.gym_id
        where s.id = $1`,
      [id, TZ],
    )
  ).rows[0];
  if (!s) return null;
  const teamIds = [s.home_t, s.home_o, s.away_t, s.away_o].filter((x): x is string => !!x);
  const may =
    (s.org === "thunder" ? hasArea(viewer, "teams", "events") : await orgHasArea(deps.pool, viewer.coachId, s.org, "teams", "events")) ||
    (teamIds.length > 0 &&
      !!(
        await deps.pool.query(
          s.org === "thunder"
            ? "select 1 from team_staff where team_id = any($1::bigint[]) and coach_id = $2 and role = 'HeadCoach'"
            : "select 1 from org_team_coaches where team_id = any($1::bigint[]) and coach_id = $2 and role = 'HeadCoach'",
          [teamIds, viewer.coachId],
        )
      ).rowCount) ||
    (!!s.officials_org && (await managesOfficials(deps.pool, viewer, s.officials_org)));
  if (!may) return null;
  const side = async (thunderId: string | null, orgId: string | null, outside: string | null): Promise<SheetTeam | null> => {
    if (outside) return { name: outside, coach: null, players: [] };
    if (!thunderId && !orgId) return null;
    const r = await deps.pool.query<{ name: string; players: SheetPlayer[] }>(
      thunderId
        ? `select t.name, coalesce((select json_agg(json_build_object('jersey', nullif(un.number, ''), 'name', x.first_name || ' ' || x.last_name)
                                      order by nullif(un.number, '')::int nulls last, lower(x.last_name), lower(x.first_name))
                     from team_players x left join team_uniforms un on un.team_id = x.team_id and un.registrant_id = x.registrant_id
                    where x.team_id = t.id), '[]') as players
             from teams t where t.id = $1`
        : `select t.name, coalesce((select json_agg(json_build_object('jersey', x.jersey, 'name', x.first_name || ' ' || x.last_name)
                                      order by nullif(x.jersey, '')::int nulls last, lower(x.last_name), lower(x.first_name))
                     from org_team_players x where x.team_id = t.id), '[]') as players
             from org_teams t where t.id = $1`,
      [thunderId ?? orgId],
    );
    return r.rows[0] ? { name: r.rows[0].name, coach: null, players: r.rows[0].players } : null;
  };
  const refs = await deps.pool.query<{ name: string }>(
    `select u.first_name || ' ' || u.last_name as name from game_officials x join users u on u.coach_id = x.coach_id
      where x.scrimmage_id = $1 order by x.position`,
    [id],
  );
  const org = await orgInfo(deps.pool, s.org);
  return {
    id,
    league: s.program,
    division: "Scrimmage",
    date: s.date,
    starts: s.starts,
    minutes: s.minutes,
    gym: s.place,
    court: "",
    address: s.address,
    home: await side(s.home_t, s.home_o, s.home_name),
    away: await side(s.away_t, s.away_o, s.away_name),
    officials: refs.rows.map((r) => r.name),
    brand: org ? { name: org.name, logo: org.bigLogo ?? org.logo } : undefined,
  };
}
