-- Publishing a League's schedule by level (SPEC.md section 13): on each Game Day (and the Brackets, all their days) REC and
-- COMP are published on their own. Who and when. Replaces scenic_published_days (193), kept for the live site until it has
-- this code: what it publishes there counts for both levels here (the trigger below).
create table scenic_published_schedules (
  program_id   bigint not null references scenic_programs(id) on delete cascade,
  day          date not null,
  level        text not null check (level in ('REC', 'COMP')),
  published_by text not null,
  published_at timestamptz not null,
  primary key (program_id, day, level)
);
alter table scenic_published_schedules enable row level security;
revoke all on scenic_published_schedules from anon, authenticated;

insert into scenic_published_schedules (program_id, day, level, published_by, published_at)
select d.program_id, d.day, l.level, d.published_by, d.published_at
  from scenic_published_days d cross join (values ('REC'), ('COMP')) l (level);

create function scenic_published_days_both() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    delete from scenic_published_schedules where program_id = old.program_id and day = old.day;
    return old;
  end if;
  insert into scenic_published_schedules (program_id, day, level, published_by, published_at)
    values (new.program_id, new.day, 'REC', new.published_by, new.published_at),
           (new.program_id, new.day, 'COMP', new.published_by, new.published_at)
    on conflict do nothing;
  return new;
end $$;
create trigger scenic_published_days_both after insert or delete on scenic_published_days
  for each row execute function scenic_published_days_both();

-- Whether a team's games that day are published: its level in the League (REC and COMP never play each other).
create function scenic_game_published(p_program bigint, p_day date, p_team bigint) returns boolean language sql stable as $$
  select exists (
    select 1 from scenic_published_schedules s
     where s.program_id = p_program and s.day = p_day
       and s.level = coalesce((select g.level from scenic_registrations r join scenic_pools o on o.id = r.pool_id
                                 join scenic_grade_groups g on g.id = o.group_id
                                where r.program_id = p_program and r.team_id = p_team),
                              (select t.level from scenic_teams t where t.id = p_team)))
$$;

-- A team's 1st game is on a day published for its level (or scored or forfeited).
create or replace function scenic_first_game(p_program bigint, p_team bigint) returns timestamptz language sql stable as $$
  select min(case when m.starts is not null then (m.day + m.starts) at time zone 'America/New_York' else m.scored_at end)
    from scenic_matchups m
   where m.program_id = p_program and (m.team_a = p_team or m.team_b = p_team) and m.team_b is not null
     and (m.score_a is not null or m.forfeit is not null
          or (m.starts is not null
              and scenic_game_published(m.program_id, m.day, p_team)
              and not exists (select 1 from scenic_team_off o
                               where o.program_id = m.program_id and o.team_id = p_team and o.off in (m.day::text, 'program'))))
$$;
revoke all on function scenic_published_days_both() from public, anon, authenticated;
revoke all on function scenic_game_published(bigint, date, bigint) from public, anon, authenticated;
revoke all on function scenic_first_game(bigint, bigint) from public, anon, authenticated;
