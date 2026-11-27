// An organization's Game Days card (SPEC.md section 14): each coming Game Day of the Leagues it plays in or hosts for, with the
// games at its gyms and its own teams' games (published ones; the rest are counted), the gyms to print scoresheets for, and the
// Leagues' rules. For its Owners, Admins and Directors of Teams or Facilities (the caller checks).
import { PLACE_SQL } from "./scenic-games";
import { gradeLabel } from "./scenic-teams";
import type { Queryable } from "./sql";
import { easternDate } from "./time";

export type DayGame = {
  id: string;
  starts: string | null;
  gym: string | null;
  court: string | null;
  home: string;
  away: string;
  group: string; // "3rd Boys REC"
  gender: string;
  grade: number;
};
export type GameDay = {
  day: string;
  leagues: string[]; // the Leagues playing that day
  gyms: { key: string; name: string; games: number }[]; // its gyms with games placed (scoresheets)
  atGyms: DayGame[]; // published games at its gyms, by time
  ours: DayGame[]; // its teams' published games, by grade then time
  waiting: number; // its teams' or its gyms' games not published yet
};
// rules: its PDF's name; url: its rules link (a Google Doc).
export type OrgGameDays = { leagues: { id: string; name: string; rules: string | null; url: string | null }[]; days: GameDay[] };

// Null when it has no teams in a League and hosts no games.
export async function orgGameDays(q: Pick<Queryable, "query">, org: string, now: Date): Promise<OrgGameDays | null> {
  const today = easternDate(now);
  const mine = org === "thunder" ? "st.thunder_team_id is not null" : "st.org_team_id in (select id from org_teams where org = $2)";
  const r = await q.query<{
    id: string; program: string; program_id: string; day: string; starts: string | null; gym: string | null; court: string | null;
    gym_key: string | null; at_ours: boolean; a_ours: boolean; b_ours: boolean; a: string; b: string | null; home_side: string | null;
    grade: number; gender: string; level: string; published: boolean;
  }>(
    `select m.id::text, p.name as program, p.id::text as program_id, m.day::text as day, to_char(m.starts, 'HH24:MI') as starts, place.gym, place.court,
            case when m.court_key like 'o%' then 'o' || split_part(substr(m.court_key, 2), '-', 1) end as gym_key,
            exists (select 1 from gyms g where m.court_key like 'o%' and g.id::text = split_part(substr(m.court_key, 2), '-', 1) and g.org = $2) as at_ours,
            exists (select 1 from scenic_teams st where st.id = m.team_a and ${mine}) as a_ours,
            exists (select 1 from scenic_teams st where st.id = m.team_b and ${mine}) as b_ours,
            ta.name as a, tb.name as b, m.home_side, g.grade, d.gender, g.level, scenic_game_published(m.program_id, m.day, m.team_a) as published
       from scenic_matchups m join scenic_programs p on p.id = m.program_id and p.kind = 'League'
       join scenic_teams ta on ta.id = m.team_a left join scenic_teams tb on tb.id = m.team_b
       join scenic_registrations r on r.program_id = m.program_id and r.team_id = m.team_a
       join scenic_pools po on po.id = r.pool_id join scenic_grade_groups g on g.id = po.group_id join scenic_divisions d on d.id = g.division_id
       ${PLACE_SQL}
      where m.day >= $1::date and ta.name not like '%(DEV)' and coalesce(tb.name, '') not like '%(DEV)'
        and (exists (select 1 from gyms g where m.court_key like 'o%' and g.id::text = split_part(substr(m.court_key, 2), '-', 1) and g.org = $2)
             or exists (select 1 from scenic_teams st where st.id in (m.team_a, m.team_b) and ${mine}))
      order by m.day, m.starts nulls last, lower(place.gym), lower(ta.name)`,
    [today, org],
  );
  // Its Leagues: the ones its teams are registered in (not ended), and the ones with games at its gyms.
  const leagues = await q.query<{ id: string; name: string; rules: string | null; url: string | null; day: string | null }>(
    `select p.id::text, p.name, case when p.rules is not null then coalesce(p.rules_name, 'Rules.pdf') end as rules, p.rules_url as url, gd.day::text as day
       from scenic_programs p left join program_game_days pg on pg.program_id = p.id and pg.kind = 'game'
       left join game_days gd on gd.id = pg.game_day_id and gd.day >= $1::date
      where p.kind = 'League' and p.ends_on >= $1::date
        and (exists (select 1 from scenic_registrations rg join scenic_teams st on st.id = rg.team_id where rg.program_id = p.id and rg.removed_by is null and ${mine})
             or exists (select 1 from scenic_matchups m join gyms g on m.court_key like 'o%' and g.id::text = split_part(substr(m.court_key, 2), '-', 1)
                         where m.program_id = p.id and g.org = $2))
      order by p.starts_on, lower(p.name), gd.day`,
    [today, org],
  );
  if (!leagues.rows.length) return null;
  const relevant = r.rows;
  const game = (m: (typeof r.rows)[number]): DayGame => {
    const aHome = (m.home_side ?? "a") === "a";
    const b = m.b ?? "TBD";
    return {
      id: m.id,
      starts: m.starts,
      gym: m.gym,
      court: m.court,
      home: aHome ? m.a : b,
      away: aHome ? b : m.a,
      group: `${gradeLabel(m.grade, m.grade)} ${m.gender} ${m.level}`,
      gender: m.gender,
      grade: m.grade,
    };
  };
  const dates = [...new Set(leagues.rows.flatMap((l) => (l.day ? [l.day] : [])))].sort();
  const days: GameDay[] = dates.map((day) => {
    const list = relevant.filter((m) => m.day === day);
    const gyms = new Map<string, { key: string; name: string; games: number }>();
    for (const m of list) if (m.at_ours && m.gym_key) gyms.set(m.gym_key, { key: m.gym_key, name: m.gym ?? "Gym", games: (gyms.get(m.gym_key)?.games ?? 0) + 1 });
    const rank = (g: string) => ["Coed", "Boys", "Girls"].indexOf(g);
    return {
      day,
      leagues: [...new Set(leagues.rows.filter((l) => l.day === day).map((l) => l.name))],
      gyms: [...gyms.values()],
      atGyms: list.filter((m) => m.at_ours && m.published).map(game),
      ours: list
        .filter((m) => (m.a_ours || m.b_ours) && m.published)
        .map(game)
        .sort((x, y) => rank(x.gender) - rank(y.gender) || x.grade - y.grade || (x.starts ?? "99").localeCompare(y.starts ?? "99")),
      waiting: list.filter((m) => !m.published).length,
    };
  });
  const seen = new Map<string, OrgGameDays["leagues"][number]>();
  for (const l of leagues.rows) seen.set(l.id, { id: l.id, name: l.name, rules: l.rules, url: l.url });
  return { leagues: [...seen.values()], days };
}
