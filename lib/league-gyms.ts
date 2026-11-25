// The gyms a League plays in, for its public view (SPEC.md section 13; no login): the same gyms the Scheduler's Grid uses
// (an approved host's gyms marked for League games on one of its Game Days, and partners' own courts with hours then), or
// one with a published game. Each with its host, address, Directions, courts, and its coming published games by day.
// A gym offered but not published shows no dates. No people.
import { directionsUrl } from "./directions";
import type { Queryable } from "./sql";
import { easternDate } from "./time";

export type LeagueGym = {
  name: string;
  hosts: string[];
  address: string | null;
  map: string | null;
  courts: number;
  days: { date: string; games: number }[]; // coming, published
};

type Row = { key: string; name: string; host: string; address: string | null; lat: number | null; lng: number | null; place: string | null; courts: number };

export async function leagueGyms(q: Pick<Queryable, "query">, now: Date, programId: string): Promise<LeagueGym[]> {
  const [gyms, games] = await Promise.all([
    q.query<Row>(
      `with prog as (select id, org from scenic_programs where id = $1),
            days as (select gd.id, gd.day from program_game_days pg join game_days gd on gd.id = pg.game_day_id where pg.program_id = $1),
            used as (select distinct case when m.court_key like 'o%' then 'o' || split_part(substr(m.court_key, 2), '-', 1)
                                          else (select 'p' || c.gym_id from partner_courts c where m.court_key ~ '^[0-9]+$' and c.id = m.court_key::bigint) end as key
                       from scenic_matchups m where m.program_id = $1 and m.court_key is not null and scenic_game_published(m.program_id, m.day, m.team_a))
       select 'o' || g.id as key, g.name, o.name as host, coalesce(g.address, g.pin_address) as address,
              coalesce(sp.pin_lat, g.pin_lat, g.lat) as lat, coalesce(sp.pin_lng, g.pin_lng, g.lng) as lng,
              case when sp.pin_lat is null and g.pin_lat is null then g.place_id end as place,
              greatest(1, (select count(*)::int from courts c where c.gym_id = g.id and c.active and c.name !~* '^goal')) as courts
         from gyms g join organizations o on o.slug = g.org
         left join scheduler_gym_pins sp on sp.gym_key = 'o' || g.id and sp.org = (select org from prog)
        where (g.active
               and exists (select 1 from org_partnerships x where x.host_org = g.org and x.for_org = (select org from prog) and x.status = 'approved')
               and exists (select 1 from gym_availability a join days d on d.day = a.day where a.gym_id = g.id and a.use = 'partner'))
           or 'o' || g.id in (select key from used)
       union all
       select 'p' || g.id, g.name, p.name, g.address, sp.pin_lat, sp.pin_lng, null,
              greatest(1, (select count(*)::int from partner_courts c where c.gym_id = g.id))
         from partner_gyms g join partners p on p.id = g.partner_id
         left join scheduler_gym_pins sp on sp.gym_key = 'p' || g.id and sp.org = (select org from prog)
        where (p.org_slug is null and exists (select 1 from court_hours h join days d on d.id = h.game_day_id join partner_courts c on c.id = h.court_id where c.gym_id = g.id))
           or 'p' || g.id in (select key from used)`,
      [programId],
    ),
    q.query<{ key: string; day: string; n: number }>(
      `select case when m.court_key like 'o%' then 'o' || split_part(substr(m.court_key, 2), '-', 1)
                   else (select 'p' || c.gym_id from partner_courts c where m.court_key ~ '^[0-9]+$' and c.id = m.court_key::bigint) end as key,
              m.day::text as day, count(*)::int as n
         from scenic_matchups m join scenic_teams ta on ta.id = m.team_a left join scenic_teams tb on tb.id = m.team_b
        where m.program_id = $1 and m.day >= $2::date and m.court_key is not null and scenic_game_published(m.program_id, m.day, m.team_a)
          and ta.name not like '%(DEV)' and coalesce(tb.name, '') not like '%(DEV)'
        group by 1, 2`,
      [programId, easternDate(now)],
    ),
  ]);
  return mergeGyms(gyms.rows, games.rows);
}

// Pure: a gym two hosts share (the same name, and not two different addresses) is one gym with both hosts.
export function mergeGyms(rows: Row[], games: { key: string; day: string; n: number }[]): LeagueGym[] {
  const out: (LeagueGym & { id: string })[] = [];
  for (const r of rows) {
    const id = r.name.trim().toLowerCase();
    let g = out.find((x) => x.id === id && (!x.address || !r.address || x.address === r.address));
    if (!g) out.push((g = { id, name: r.name.trim(), hosts: [], address: null, map: null, courts: 0, days: [] }));
    if (!g.hosts.includes(r.host)) g.hosts.push(r.host);
    g.address ??= r.address;
    g.map ??= directionsUrl(r.lat, r.lng, r.place);
    g.courts = Math.max(g.courts, r.courts);
    for (const x of games.filter((x) => x.key === r.key)) {
      const d = g.days.find((y) => y.date === x.day);
      if (d) d.games += x.n;
      else g.days.push({ date: x.day, games: x.n });
    }
  }
  for (const g of out) {
    g.hosts.sort((a, b) => a.localeCompare(b));
    g.days.sort((a, b) => a.date.localeCompare(b.date));
  }
  return out
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((g) => ({ name: g.name, hosts: g.hosts, address: g.address, map: g.map, courts: g.courts, days: g.days }));
}
