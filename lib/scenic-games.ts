// Scenic City League games for teams (SPEC.md section 13, step 7): each matchup with its opponent and, once placed on
// the Scheduler's Grid, the gym, court and start time. Shown on the Scheduler's Teams tab and on each team's card.
import type { Pool } from "pg";
import { directionsUrl } from "./directions";
import { gradeLabel } from "./scenic-teams";

export type ScheduledGame = {
  id: string; // the matchup
  programId: string;
  program: string;
  date: string; // YYYY-MM-DD
  opponent: string; // "TBD" until it has one
  home: boolean; // this team is the home team
  opponentGroup: string; // "5th REC"
  gym: string | null; // where and when, once placed on the Grid
  court: string | null;
  address: string | null;
  map: string | null; // Directions (the Scheduler's pin, else the host's pin or Google place)
  starts: string | null; // "HH:MM" Eastern
  published: boolean; // its League's schedule is published (a Director of Programs or Scheduling did)
};

// Where a game slot is: a partner's court ("123"), or an organization's gym court ("o39-12") or whole gym ("o39-gym").
// Where a game is: its gym, court and address, and where Directions go (map_lat, map_lng, map_place): the Scheduler's own
// pin for that gym (scheduler_gym_pins, the program's organization), else the host's Directions pin, else the host's
// Google place. A gym the Scheduler typed in for an outside host has only the Scheduler's pin.
export const PLACE_SQL = `left join lateral (
    select g.name as gym, c.name as court, g.address,
           sp.pin_lat as map_lat, sp.pin_lng as map_lng, null::text as map_place
      from partner_courts c join partner_gyms g on g.id = c.gym_id
      left join scheduler_gym_pins sp on sp.gym_key = 'p' || g.id
        and sp.org = (select sx.org from scenic_programs sx where sx.id = m.program_id)
     where m.court_key ~ '^[0-9]+$' and c.id = m.court_key::bigint
    union all
    select g.name, coalesce(c.name, 'Main'), coalesce(g.address, g.pin_address),
           coalesce(sp.pin_lat, g.pin_lat, g.lat), coalesce(sp.pin_lng, g.pin_lng, g.lng),
           case when sp.pin_lat is null and g.pin_lat is null then g.place_id end
      from gyms g
      left join courts c on c.id::text = split_part(substr(m.court_key, 2), '-', 2)
      left join scheduler_gym_pins sp on sp.gym_key = 'o' || g.id
        and sp.org = (select sx.org from scenic_programs sx where sx.id = m.program_id)
     where m.court_key like 'o%' and g.id = split_part(substr(m.court_key, 2), '-', 1)::bigint
  ) place on true`;

// Teams' matchups in Scenic City Leagues (scenic team ids), by date then time, with the opponent and, once placed on the
// Grid, the gym, court and start time. Callers check the viewer may see these teams.
export async function scheduledGames(q: Pick<Pool, "query">, teamIds: string[]): Promise<Record<string, ScheduledGame[]>> {
  if (!teamIds.length) return {};
  const r = await q.query<
    Omit<ScheduledGame, "opponentGroup" | "map"> & {
      team: string;
      grade: number | null;
      level: string | null;
      map_lat: number | null;
      map_lng: number | null;
      map_place: string | null;
    }
  >(
    `select x.me::text as team, m.id::text as id, p.id::text as "programId", p.name as program, m.day::text as date,
            coalesce(o.name, 'TBD') as opponent, coalesce(m.home_side, 'a') = x.side as home,
            gg.grade, gg.level, place.gym, place.court, place.address, place.map_lat, place.map_lng, place.map_place,
            to_char(m.starts, 'HH24:MI') as starts,
            p.schedule_published_at is not null as published
       from scenic_matchups m
       cross join lateral (values (m.team_a, m.team_b, 'a'), (m.team_b, m.team_a, 'b')) x (me, other, side)
       join scenic_programs p on p.id = m.program_id
       left join scenic_teams o on o.id = x.other
       left join scenic_registrations r on r.program_id = m.program_id and r.team_id = x.other
       left join scenic_pools po on po.id = r.pool_id
       left join scenic_grade_groups gg on gg.id = po.group_id
       ${PLACE_SQL}
      where x.me = any($1::bigint[])
      order by m.day, m.starts nulls last, lower(coalesce(o.name, 'TBD'))`,
    [teamIds],
  );
  const out: Record<string, ScheduledGame[]> = {};
  for (const { team, grade, level, map_lat, map_lng, map_place, ...g } of r.rows)
    (out[team] ??= []).push({
      ...g,
      map: directionsUrl(map_lat, map_lng, map_place),
      opponentGroup: grade === null ? "" : `${gradeLabel(grade, grade)} ${level}`,
    });
  return out;
}
