-- A League's Registration Options (SPEC.md section 13), each with its own fee: ALL Season (1 game each Game Day + the
-- brackets; one fee), Single Day (1 Game), Single Day (2nd Game: a day the team already plays becomes 2 games), Single
-- Day (2 Games) (the Single Day fees are per date). GG = games guaranteed that day.
create table scenic_program_options (
  program_id  bigint not null references scenic_programs(id) on delete cascade,
  kind        text not null check (kind in ('all_season', 'single_1', 'single_2nd', 'single_2')),
  fee_cents   integer check (fee_cents between 0 and 10000000),
  primary key (program_id, kind)
);
alter table scenic_program_options enable row level security;
revoke all on scenic_program_options from anon, authenticated;
