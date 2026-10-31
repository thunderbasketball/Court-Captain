-- Scenic City programs (SPEC.md section 13, build step 6b): League, Circuit, Tournament. Each has divisions
-- (gender + grade) and teams registered into them. A team is in as soon as it registers; a Director marks Paid.

create table scenic_programs (
  id           bigserial primary key,
  kind         text not null check (kind in ('League', 'Circuit', 'Tournament')),
  name         text not null,
  starts_on    date not null,
  ends_on      date not null check (ends_on >= starts_on),
  reg_opens    date not null,
  reg_closes   date not null check (reg_closes >= reg_opens),
  fee_cents    integer check (fee_cents between 0 and 10000000),
  created_by   text not null,
  created_at   timestamptz not null default now(),
  updated_by   text not null,
  updated_at   timestamptz not null default now()
);
create unique index scenic_programs_name on scenic_programs (lower(name));

create table scenic_divisions (
  id          bigserial primary key,
  program_id  bigint not null references scenic_programs(id) on delete cascade,
  gender      text not null check (gender in ('Boys', 'Girls')),
  grade       smallint not null check (grade between 0 and 12),
  unique (program_id, gender, grade)
);

-- One registration per team per program, in the division matching the team's gender and (higher) grade.
create table scenic_registrations (
  program_id     bigint not null references scenic_programs(id) on delete cascade,
  team_id        bigint not null references scenic_teams(id) on delete cascade,
  division_id    bigint not null references scenic_divisions(id) on delete restrict,
  registered_by  text not null,
  registered_at  timestamptz not null default now(),
  paid           boolean not null default false,
  paid_set_by    text,
  paid_set_at    timestamptz,
  primary key (program_id, team_id)
);
create index scenic_registrations_division on scenic_registrations (division_id);

alter table scenic_programs enable row level security;
alter table scenic_divisions enable row level security;
alter table scenic_registrations enable row level security;
revoke all on scenic_programs, scenic_divisions, scenic_registrations from anon, authenticated;
revoke all on sequence scenic_programs_id_seq, scenic_divisions_id_seq from anon, authenticated;
