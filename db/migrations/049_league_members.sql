-- Registering an organization's teams with a league (SPEC.md section 14): the organization (e.g. East Ridge) asks a
-- league with Team Registrations (Scenic City) once; the league's Admins or Directors of Teams approve. Then its
-- Admins and Directors of Teams register its teams into the league's programs.
create table league_members (
  id            bigserial primary key,
  org           text not null references organizations(slug) on delete cascade,  -- registers teams (East Ridge)
  league        text not null references organizations(slug) on delete cascade,  -- runs programs (Scenic City)
  status        text not null check (status in ('pending', 'approved', 'declined')),
  requested_by  text not null,
  requested_at  timestamptz not null default now(),
  decided_by    text,
  decided_at    timestamptz,
  check (org <> league),
  unique (org, league)
);
alter table league_members enable row level security;
revoke all on league_members from anon, authenticated;
revoke all on sequence league_members_id_seq from anon, authenticated;

-- A registered organization's team in Scenic City: a copy of it (under the organization's partner record), made when it
-- first registers for a program and kept in step from the organization. Read-only in Scenic City.
alter table scenic_teams add column org_team_id bigint unique references org_teams(id) on delete cascade;
