-- A team's own practices (SPEC.md section 4, "Own gym practices"): at a place the team found itself (not one of the
-- organization's gyms), any day and time, any length, with no booking limits. Thunder's teams and every organization's
-- teams: a Thunder team is in teams, another organization's in org_teams. Made weekly, its weeks share a series.
create table team_practices (
  id              bigserial primary key,
  org             text not null references organizations(slug) on update cascade on delete cascade,
  thunder_team_id bigint references teams(id) on delete cascade,
  org_team_id     bigint references org_teams(id) on delete cascade,
  location        text not null check (length(location) between 1 and 80),
  starts_at       timestamptz not null,
  minutes         smallint not null check (minutes between 15 and 240),
  series          uuid,
  added_by        text not null,
  added_at        timestamptz not null default now(),
  check ((org = 'thunder') = (thunder_team_id is not null) and (thunder_team_id is null) <> (org_team_id is null))
);
-- One practice per team per start time (adding the same one again skips it).
create unique index team_practices_thunder on team_practices (thunder_team_id, starts_at) where thunder_team_id is not null;
create unique index team_practices_org on team_practices (org_team_id, starts_at) where org_team_id is not null;
create index team_practices_series on team_practices (series) where series is not null;

alter table team_practices enable row level security;
revoke all on team_practices from anon, authenticated;
revoke all on sequence team_practices_id_seq from anon, authenticated;
