-- Scenic City programs (SPEC.md section 13, step 6b), reshaped:
--   Division = a gender and a group of grades (e.g. Boys K–1st). Boys and Girls stay separate.
--   Grade group = one grade at one level inside a division (e.g. K REC, 2nd COMP).
--   Pool = a set of teams inside a grade group (Pool A, Pool B…).
-- A registered team sits in a pool. Nothing was registered yet, so the old tables are rebuilt (the live site doesn't use them).

drop table scenic_registrations;
drop table scenic_divisions;

create table scenic_divisions (
  id          bigserial primary key,
  program_id  bigint not null references scenic_programs(id) on delete cascade,
  gender      text not null check (gender in ('Boys', 'Girls')),
  grade_low   smallint not null check (grade_low between 0 and 12),
  grade_high  smallint not null check (grade_high between 0 and 12 and grade_high >= grade_low),
  unique (program_id, gender, grade_low)
);

create table scenic_grade_groups (
  id           bigserial primary key,
  division_id  bigint not null references scenic_divisions(id) on delete cascade,
  grade        smallint not null check (grade between 0 and 12),
  level        text not null check (level in ('COMP', 'REC')),
  unique (division_id, grade, level)
);

create table scenic_pools (
  id        bigserial primary key,
  group_id  bigint not null references scenic_grade_groups(id) on delete cascade,
  name      text not null,
  unique (group_id, name)
);

create table scenic_registrations (
  program_id     bigint not null references scenic_programs(id) on delete cascade,
  team_id        bigint not null references scenic_teams(id) on delete cascade,
  pool_id        bigint not null references scenic_pools(id) on delete restrict,
  registered_by  text not null,
  registered_at  timestamptz not null default now(),
  paid           boolean not null default false,
  paid_set_by    text,
  paid_set_at    timestamptz,
  moved_by       text,
  moved_at       timestamptz,
  primary key (program_id, team_id)
);
create index scenic_registrations_pool on scenic_registrations (pool_id);

alter table scenic_divisions enable row level security;
alter table scenic_grade_groups enable row level security;
alter table scenic_pools enable row level security;
alter table scenic_registrations enable row level security;
revoke all on scenic_divisions, scenic_grade_groups, scenic_pools, scenic_registrations from anon, authenticated;
revoke all on sequence scenic_divisions_id_seq, scenic_grade_groups_id_seq, scenic_pools_id_seq from anon, authenticated;
