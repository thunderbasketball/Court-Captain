-- Publishing a League's schedule one event at a time (SPEC.md section 13): each Game Day (the Brackets together, on all
-- their days) is published to the public page, team pages and families on its own. Who and when. (Before: the whole
-- schedule at once, scenic_programs.schedule_published_at; those published that way have every day here.)
create table scenic_published_days (
  program_id   bigint not null references scenic_programs(id) on delete cascade,
  day          date not null,
  published_by text not null,
  published_at timestamptz not null,
  primary key (program_id, day)
);
alter table scenic_published_days enable row level security;
revoke all on scenic_published_days from anon, authenticated;

insert into scenic_published_days (program_id, day, published_by, published_at)
select distinct p.id, d.day, coalesce(p.schedule_published_by, 'import'), p.schedule_published_at
  from scenic_programs p
  join (select pg.program_id, g.day from program_game_days pg join game_days g on g.id = pg.game_day_id
        union select program_id, day from scenic_matchups) d on d.program_id = p.id
 where p.schedule_published_at is not null
on conflict do nothing;

-- A team's 1st game is on a published day (or scored or forfeited).
create or replace function scenic_first_game(p_program bigint, p_team bigint) returns timestamptz language sql stable as $$
  select min(case when m.starts is not null then (m.day + m.starts) at time zone 'America/New_York' else m.scored_at end)
    from scenic_matchups m
   where m.program_id = p_program and (m.team_a = p_team or m.team_b = p_team) and m.team_b is not null
     and (m.score_a is not null or m.forfeit is not null
          or (m.starts is not null
              and exists (select 1 from scenic_published_days d where d.program_id = m.program_id and d.day = m.day)
              and not exists (select 1 from scenic_team_off o
                               where o.program_id = m.program_id and o.team_id = p_team and o.off in (m.day::text, 'program'))))
$$;
