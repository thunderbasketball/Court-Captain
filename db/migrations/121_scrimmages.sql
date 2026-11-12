-- Scrimmages (SPEC.md section 14): an organization with CourtPlayers schedules a scrimmage game for teams in one of its
-- player programs: two of its own teams, or one of its teams against an outside team typed in; at one of its gyms and
-- courts (that court's practice slots in that time are blocked, like a blackout noted "Scrimmage", and freed when it's
-- removed), or at any place typed in. A team is Thunder's (teams) or another organization's (org_teams).
create table scrimmages (
  id                    bigint generated always as identity primary key,
  org                   text not null references organizations(slug) on update cascade on delete cascade,
  program_id            bigint not null references player_programs(id) on delete cascade,
  home_thunder_team_id  bigint references teams(id) on delete cascade,
  home_org_team_id      bigint references org_teams(id) on delete cascade,
  away_thunder_team_id  bigint references teams(id) on delete cascade,
  away_org_team_id      bigint references org_teams(id) on delete cascade,
  away_name             text check (length(away_name) between 1 and 60),  -- an outside team
  starts_at             timestamptz not null,
  minutes               int not null check (minutes between 30 and 240),
  court_id              bigint references courts(id) on delete set null,  -- one of the organization's courts
  place                 text not null check (length(place) between 1 and 120), -- "Gym · Court", or the place typed in
  added_by              text not null,
  added_at              timestamptz not null default now(),
  check (num_nonnulls(home_thunder_team_id, home_org_team_id) = 1),
  check (num_nonnulls(away_thunder_team_id, away_org_team_id, away_name) = 1)
);
create index scrimmages_program on scrimmages (program_id, starts_at);
create index scrimmages_court on scrimmages (court_id, starts_at) where court_id is not null;

-- The practice slots a scrimmage blocks (blackout, note "Scrimmage …").
alter table slots add column scrimmage_id bigint references scrimmages(id) on delete set null;

alter table scrimmages enable row level security;
revoke all on scrimmages from anon, authenticated;
