-- What a team registered for in a League (SPEC.md section 13): ALL Season, and/or Single Day options on chosen Game Days.
-- Teams registered before Registration Options were ALL Season.
alter table scenic_registrations add column all_season boolean not null default false;
update scenic_registrations set all_season = true;

create table scenic_registration_days (
  program_id     bigint not null,
  team_id        bigint not null,
  game_day_id    bigint not null references game_days(id) on delete cascade,
  kind           text not null check (kind in ('single_1', 'single_2nd', 'single_2')),
  registered_by  text not null,
  registered_at  timestamptz not null default now(),
  primary key (program_id, team_id, game_day_id, kind),
  foreign key (program_id, team_id) references scenic_registrations (program_id, team_id) on delete cascade
);
alter table scenic_registration_days enable row level security;
revoke all on scenic_registration_days from anon, authenticated;
