-- A League team's roster (SPEC.md section 14): Scenic City's League teams kept here (the FastBreak club's, outside clubs',
-- Solo teams) enter their players on their team page (its coach, or Scenic City's Directors of Teams). An organization's
-- or Thunder's team keeps its roster there. Who added each player is recorded.
create table scenic_team_players (
  id          bigserial primary key,
  team_id     bigint not null references scenic_teams(id) on delete cascade,
  first_name  text not null,
  last_name   text not null,
  grade       smallint check (grade between -1 and 12),
  jersey      text check (jersey ~ '^[0-9]{1,2}$'),
  birthdate   date check (birthdate between '1990-01-01' and '2035-12-31'),
  added_by    text not null,
  added_at    timestamptz not null default now()
);
create index scenic_team_players_team on scenic_team_players (team_id);
alter table scenic_team_players enable row level security;
revoke all on scenic_team_players from anon, authenticated;
revoke all on sequence scenic_team_players_id_seq from anon, authenticated;
