-- Scenic City Scheduler (SPEC.md section 13, step 7): matchups for one division on one Game Day. Admins and Directors of
-- Scheduling tap Create matchups; the app pairs the division's teams playing that day (1GG = one game, 2GG = two),
-- keeping pairings new against the program's other Game Days. Creating again replaces that division's matchups that day.
create table scenic_matchups (
  id           bigserial primary key,
  program_id   bigint not null references scenic_programs(id) on delete cascade,
  division_id  bigint not null references scenic_divisions(id) on delete cascade,
  day          date not null,
  team_a       bigint not null,
  team_b       bigint not null,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  check (team_a < team_b),
  unique (program_id, day, team_a, team_b),
  foreign key (program_id, team_a) references scenic_registrations (program_id, team_id) on delete cascade,
  foreign key (program_id, team_b) references scenic_registrations (program_id, team_id) on delete cascade
);
create index scenic_matchups_day on scenic_matchups (program_id, day, division_id);
alter table scenic_matchups enable row level security;
revoke all on scenic_matchups from anon, authenticated;
