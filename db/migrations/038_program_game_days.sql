-- Scenic City (SPEC.md section 13, step 6b): the game dates each program plays. Picking a date on a program makes it a
-- Scenic City game day (game_days), where hosting partners give court hours.
create table program_game_days (
  program_id   bigint not null references scenic_programs(id) on delete cascade,
  game_day_id  bigint not null references game_days(id) on delete cascade,
  added_by     text not null,
  added_at     timestamptz not null default now(),
  primary key (program_id, game_day_id)
);
create index program_game_days_day on program_game_days (game_day_id);

alter table program_game_days enable row level security;
revoke all on program_game_days from anon, authenticated;
