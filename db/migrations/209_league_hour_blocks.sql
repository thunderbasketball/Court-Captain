-- The League's own schedule requests (SPEC.md section 13): its Owners, Admins and Directors of Scheduling block a team by
-- the hour on chosen Game Days (each hour as its start, 0–23), beside the team's own requests. Only the League's staff see
-- them; the Grid never places the team's game in a blocked hour. Who did it recorded.
set local lock_timeout = '5s';
create table scenic_league_blocks (
  program_id  bigint not null,
  team_id     bigint not null,
  day         date not null,
  hours       smallint[] not null check (cardinality(hours) between 1 and 24 and hours <@ array[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]::smallint[]),
  set_by      text not null,
  set_at      timestamptz not null default now(),
  primary key (program_id, team_id, day),
  foreign key (program_id, team_id) references scenic_registrations (program_id, team_id) on delete cascade
);
create index scenic_league_blocks_day on scenic_league_blocks (day, team_id);
alter table scenic_league_blocks enable row level security;
revoke all on scenic_league_blocks from anon, authenticated;
