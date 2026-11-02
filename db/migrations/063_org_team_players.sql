-- Rosters for a registered organization's teams (SPEC.md section 14): players typed in or imported (organizations have
-- no player registrations yet). Who added each is recorded.
create table org_team_players (
  id          bigserial primary key,
  team_id     bigint not null references org_teams(id) on delete cascade,
  first_name  text not null,
  last_name   text not null,
  grade       smallint not null check (grade between 0 and 12),
  jersey      text check (jersey ~ '^[0-9]{1,2}$'),
  added_by    text not null,
  added_at    timestamptz not null default now()
);
create index org_team_players_team on org_team_players (team_id);
create unique index org_team_players_name on org_team_players (team_id, lower(first_name), lower(last_name));
alter table org_team_players enable row level security;
revoke all on org_team_players from anon, authenticated;
revoke all on sequence org_team_players_id_seq from anon, authenticated;
