-- Teams for any organization (SPEC.md section 14, Team Management): every team belongs to its organization. Kept apart
-- from Thunder's teams (its rosters, uniforms and practices) and Scenic City's registered teams. Grade: one grade, or two
-- in a row (3rd/4th), listed with the higher grade (0 = K … 12). Names are unique within an organization.
create table org_teams (
  id          bigserial primary key,
  org         text not null references organizations(slug) on delete cascade,
  name        text not null,
  gender      text not null check (gender in ('Boys', 'Girls')),
  grade_low   smallint not null check (grade_low between 0 and 12),
  grade       smallint not null check (grade between 0 and 12 and grade - grade_low in (0, 1)),
  level       text not null check (level in ('COMP', 'REC')),
  created_by  text not null,
  created_at  timestamptz not null default now()
);
create unique index org_teams_name on org_teams (org, lower(name));

-- A team's coaches: one Head Coach, any number of Assistant Coaches. Each gets the organization's Coach role.
create table org_team_coaches (
  team_id   bigint not null references org_teams(id) on delete cascade,
  coach_id  text not null references users(coach_id) on delete cascade,
  role      text not null check (role in ('HeadCoach', 'AsstCoach')),
  added_by  text not null,
  added_at  timestamptz not null default now(),
  primary key (team_id, coach_id)
);
create unique index org_team_coaches_one_head on org_team_coaches (team_id) where role = 'HeadCoach';
create index org_team_coaches_coach on org_team_coaches (coach_id);

alter table org_teams enable row level security;
alter table org_team_coaches enable row level security;
revoke all on org_teams, org_team_coaches from anon, authenticated;
revoke all on sequence org_teams_id_seq from anon, authenticated;
