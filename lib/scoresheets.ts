// Printable scoresheets (SPEC.md section 13, Scheduler): one sheet per League game placed at a gym on a Game Day, by
// court then start time, filled in with the League, division, date, time, gym and court, Home and Away teams, their
// coaches and their rosters (jersey numbers when the team has them). For the Scheduler's Admins and Directors of
// Scheduling, and for an organization's own gyms its Admins and Directors of Facilities (Documents card). Read only.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { orgHasArea } from "./org-admin";
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
