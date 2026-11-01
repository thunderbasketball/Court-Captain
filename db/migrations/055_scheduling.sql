-- Scenic City scheduling (SPEC.md section 13): a Director of Scheduling area. Admins and Directors of Scheduling take a
-- registered team out of one Game Day, the Brackets, or the whole program, and can restore it. The team stays listed
-- (crossed out), with who took it out and when.
alter table director_areas drop constraint director_areas_area_check;
alter table director_areas add constraint director_areas_area_check
  check (area in ('players', 'teams', 'coaches', 'facilities', 'programs', 'officials', 'scheduling'));

alter table scenic_registrations add column removed_by text, add column removed_at timestamptz;

create table scenic_team_off (
  program_id  bigint not null,
  team_id     bigint not null,
  off         text not null check (off = 'brackets' or off ~ '^\d{4}-\d{2}-\d{2}$'),  -- a Game Day, or the Brackets
  set_by      text not null,
  set_at      timestamptz not null default now(),
  primary key (program_id, team_id, off),
  foreign key (program_id, team_id) references scenic_registrations (program_id, team_id) on delete cascade
);
alter table scenic_team_off enable row level security;
revoke all on scenic_team_off from anon, authenticated;
