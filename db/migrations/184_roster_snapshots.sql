-- League rosters (SPEC.md section 13): a League takes a snapshot of a team's roster when the team plays its 1st game (a
-- forfeit counts); that's its League roster for the rest of the season. Saved just before the first change to the
-- team's roster after that game's start (until then the current roster is the snapshot), or when it's first looked at.
-- Directors of Teams (the League's) fix one; who did it is recorded.
create table scenic_roster_snapshots (
  program_id    bigint not null,
  team_id       bigint not null,
  first_game_at timestamptz not null,
  taken_at      timestamptz not null default now(),
  primary key (program_id, team_id),
  foreign key (program_id, team_id) references scenic_registrations (program_id, team_id) on delete cascade
);
create table scenic_snapshot_players (
  id          bigserial primary key,
  program_id  bigint not null,
  team_id     bigint not null,
  first_name  text not null,
  last_name   text not null,
  grade       text,
  jersey      text,
  birthdate   date,
  added_by    text,          -- null: in the snapshot itself
  added_at    timestamptz,
  removed_by  text,
  removed_at  timestamptz,
  foreign key (program_id, team_id) references scenic_roster_snapshots (program_id, team_id) on delete cascade
);
create index scenic_snapshot_players_team on scenic_snapshot_players (program_id, team_id);
alter table scenic_roster_snapshots enable row level security;
alter table scenic_snapshot_players enable row level security;
revoke all on scenic_roster_snapshots from anon, authenticated;
revoke all on scenic_snapshot_players from anon, authenticated;
revoke all on sequence scenic_snapshot_players_id_seq from anon, authenticated;

-- When a team's 1st game in a program starts: its first game on the posted schedule it isn't sitting out, or one
-- already scored or forfeited. Null: none yet.
create function scenic_first_game(p_program bigint, p_team bigint) returns timestamptz language sql stable as $$
  select min(case when m.starts is not null then (m.day + m.starts) at time zone 'America/New_York' else m.scored_at end)
    from scenic_matchups m join scenic_programs p on p.id = m.program_id
   where m.program_id = p_program and (m.team_a = p_team or m.team_b = p_team) and m.team_b is not null
     and (m.score_a is not null or m.forfeit is not null
          or (p.schedule_published_at is not null and m.starts is not null
              and not exists (select 1 from scenic_team_off o
                               where o.program_id = m.program_id and o.team_id = p_team and o.off in (m.day::text, 'program'))))
$$;

-- Saves the team's snapshot in each League it's in (not ended) whose 1st game has started, once.
create function scenic_take_snapshots(p_team bigint, p_now timestamptz) returns void language plpgsql as $$
declare
  r record;
  f timestamptz;
begin
  for r in
    select sr.program_id from scenic_registrations sr join scenic_programs p on p.id = sr.program_id
     where sr.team_id = p_team and p.kind = 'League' and p.ends_on >= (p_now at time zone 'America/New_York')::date
       and not exists (select 1 from scenic_roster_snapshots s where s.program_id = sr.program_id and s.team_id = p_team)
  loop
    f := scenic_first_game(r.program_id, p_team);
    if f is null or f > p_now then continue; end if;
    insert into scenic_roster_snapshots (program_id, team_id, first_game_at, taken_at)
      values (r.program_id, p_team, f, p_now) on conflict do nothing;
    if not found then continue; end if;
    insert into scenic_snapshot_players (program_id, team_id, first_name, last_name, grade, jersey, birthdate)
      select r.program_id, p_team, x.first_name, x.last_name, x.grade, x.jersey, x.birthdate from (
        select tp.first_name, tp.last_name, tp.grade::text as grade, nullif(u.number, '') as jersey, g.birthdate
          from scenic_teams t join team_players tp on tp.team_id = t.thunder_team_id
          left join team_uniforms u on u.team_id = tp.team_id and u.registrant_id = tp.registrant_id
          left join lateral (select birthdate from registrations where registrant_id = tp.registrant_id and birthdate is not null limit 1) g on true
         where t.id = p_team
        union all
        select op.first_name, op.last_name, op.grade::text, op.jersey, op.birthdate
          from scenic_teams t join org_team_players op on op.team_id = t.org_team_id where t.id = p_team
        union all
        select sp.first_name, sp.last_name, sp.grade::text, sp.jersey, sp.birthdate
          from scenic_teams t join scenic_team_players sp on sp.team_id = t.id
         where t.id = p_team and t.org_team_id is null and t.thunder_team_id is null) x;
  end loop;
end $$;

-- Before a team's roster changes: save its snapshot first if its 1st game has started.
create function snapshot_before_roster_change() returns trigger language plpgsql as $$
declare
  ids bigint[] := '{}';
  v bigint;
begin
  if tg_op <> 'INSERT' then ids := ids || old.team_id; end if;
  if tg_op <> 'DELETE' and not (new.team_id = any (ids)) then ids := ids || new.team_id; end if;
  for v in
    select t.id from scenic_teams t
     where (tg_argv[0] = 'org' and t.org_team_id = any (ids)) or (tg_argv[0] = 'thunder' and t.thunder_team_id = any (ids))
        or (tg_argv[0] = 'league' and t.id = any (ids))
  loop
    perform scenic_take_snapshots(v, now());
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger org_team_players_snapshot before insert or delete or update of team_id, first_name, last_name, grade, jersey
  on org_team_players for each row execute function snapshot_before_roster_change('org');
create trigger scenic_team_players_snapshot before insert or delete or update of team_id, first_name, last_name, grade, jersey
  on scenic_team_players for each row execute function snapshot_before_roster_change('league');
create trigger team_players_snapshot before insert or delete or update of team_id, first_name, last_name, grade
  on team_players for each row execute function snapshot_before_roster_change('thunder');
create trigger team_uniforms_snapshot before insert or delete or update of team_id, number
  on team_uniforms for each row execute function snapshot_before_roster_change('thunder');
revoke all on function scenic_first_game(bigint, bigint) from public, anon, authenticated;
revoke all on function scenic_take_snapshots(bigint, timestamptz) from public, anon, authenticated;
revoke all on function snapshot_before_roster_change() from public, anon, authenticated;
