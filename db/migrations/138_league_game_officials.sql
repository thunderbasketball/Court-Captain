-- Officials on League games too (SPEC.md section 14, 4c-4): a League game placed on the Scheduler's Grid at a gym that
-- has an officials group (gym_officials) shows on that group's Games to officiate board, like a scrimmage that picked
-- the group. game_officials holds either a scrimmage or a League game (matchup); game_key names it ('s12' / 'm34').
alter table game_officials alter column scrimmage_id drop not null;
alter table game_officials add column matchup_id bigint references scenic_matchups(id) on delete cascade;
alter table game_officials add constraint game_officials_one_game check (num_nonnulls(scrimmage_id, matchup_id) = 1);
alter table game_officials add column game_key text
  generated always as (case when scrimmage_id is not null then 's' || scrimmage_id else 'm' || matchup_id end) stored;
create unique index game_officials_matchup_spot on game_officials (matchup_id, position) where matchup_id is not null;
create unique index game_officials_matchup_coach on game_officials (matchup_id, coach_id) where matchup_id is not null;
create index game_officials_key on game_officials (game_key);

-- A League game moved (another time, day or court) or taken off the Grid: its officials come off it.
create function game_officials_matchup_moved() returns trigger language plpgsql as $$
begin
  if new.court_key is distinct from old.court_key or new.starts is distinct from old.starts or new.day is distinct from old.day then
    delete from game_officials where matchup_id = new.id;
  end if;
  return new;
end $$;
create trigger game_officials_matchup_moved after update on scenic_matchups
  for each row execute function game_officials_matchup_moved();

-- Every game an officials group schedules: scrimmages that picked it, and League games at gyms it officiates.
create view officiated_games as
  select 's' || s.id as key, 'Scrimmage'::text as kind, s.id as scrimmage_id, null::bigint as matchup_id,
         s.officials_org, s.org, s.starts_at, s.minutes, s.place, nullif(coalesce(g.address, g.pin_address), '') as address,
         s.org || ':' || coalesce('g' || s.gym_id, 'p' || lower(s.place)) as gym,
         coalesce(s.home_name, (select name from teams where id = s.home_thunder_team_id),
                  (select name from org_teams where id = s.home_org_team_id), 'TBD') as home,
         coalesce(s.away_name, (select name from teams where id = s.away_thunder_team_id),
                  (select name from org_teams where id = s.away_org_team_id), 'TBD') as away
    from scrimmages s left join gyms g on g.id = s.gym_id
   where s.officials_org is not null
  union all
  select 'm' || m.id, 'League', null, m.id,
         go.officials_org, p.org, (m.day + m.starts) at time zone 'America/New_York',
         coalesce(gd.minutes_override, p.game_minutes, 55), place.name, place.address,
         'L:' || place.gym_key,
         coalesce((select name from scenic_teams where id = case when coalesce(m.home_side, 'a') = 'a' then m.team_a else m.team_b end), 'TBD'),
         coalesce((select name from scenic_teams where id = case when coalesce(m.home_side, 'a') = 'a' then m.team_b else m.team_a end), 'TBD')
    from scenic_matchups m
    join scenic_programs p on p.id = m.program_id
    left join game_days gd on gd.day = m.day
    cross join lateral (
      select 'p' || c.gym_id as gym_key, pg.name || ' · ' || c.name as name, nullif(pg.address, '') as address
        from partner_courts c join partner_gyms pg on pg.id = c.gym_id
       where m.court_key ~ '^[0-9]+$' and c.id = m.court_key::bigint
      union all
      select 'o' || g.id, g.name || coalesce(' · ' || c.name, ''), nullif(coalesce(g.address, g.pin_address), '')
        from gyms g left join courts c on c.id::text = split_part(substr(m.court_key, 2), '-', 2)
       where m.court_key like 'o%' and g.id = split_part(substr(m.court_key, 2), '-', 1)::bigint
    ) place
    join gym_officials go on go.org = p.org and go.gym_key = place.gym_key
   where m.court_key is not null and m.starts is not null;
revoke all on officiated_games from anon, authenticated;
