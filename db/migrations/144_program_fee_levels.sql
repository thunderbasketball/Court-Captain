-- A player program's fee levels (SPEC.md section 14: the Fees card): how many there are (1 by default), each with its
-- fee and the genders and grades it's for (Boys K–5 $150; Boys 6–8 and Girls 3–8 $175). A gender's grade is in one level
-- only. The program's genders and grades (boys_grades, girls_grades) are all its levels together.
create table program_fee_levels (
  id           bigint generated always as identity primary key,
  program_id   bigint not null references player_programs(id) on delete cascade,
  position     smallint not null check (position between 1 and 10),
  fee_cents    integer check (fee_cents between 0 and 10000000), -- null: no fee set
  boys_grades  text[] not null default '{}' check (boys_grades <@ '{K,1,2,3,4,5,6,7,8,9,10,11,12}'),
  girls_grades text[] not null default '{}' check (girls_grades <@ '{K,1,2,3,4,5,6,7,8,9,10,11,12}'),
  set_by       text not null,
  set_at       timestamptz not null default now(),
  unique (program_id, position)
);
alter table program_fee_levels enable row level security;
revoke all on program_fee_levels from anon, authenticated;
