-- Scenic City teams (SPEC.md section 13, build step 6: Team Registrations). Kept apart from Thunder's teams.
-- A team belongs to a partner (made by its contacts) or to a Solo coach (its owner). Grade: one grade, or two
-- grades in a row (e.g. 3rd/4th), listed and played with the higher grade. Grade numbers: 0 = K … 12.

create table scenic_teams (
  id              bigserial primary key,
  name            text not null,
  gender          text not null check (gender in ('Boys', 'Girls')),
  grade_low       smallint not null check (grade_low between 0 and 12),
  grade           smallint not null check (grade between 0 and 12 and grade - grade_low in (0, 1)),
  partner_id      bigint references partners(id) on delete restrict,
  owner_coach_id  text references users(coach_id) on delete restrict,
  coach_id        text not null references users(coach_id) on delete restrict,
  created_by      text not null,
  created_at      timestamptz not null default now(),
  updated_by      text not null,
  updated_at      timestamptz not null default now(),
  check ((partner_id is null) <> (owner_coach_id is null))
);
-- Team names are unique within a partner, or within a Solo coach's teams.
create unique index scenic_teams_name on scenic_teams (coalesce('p' || partner_id::text, 'o' || owner_coach_id), lower(name));
create index scenic_teams_coach on scenic_teams (coach_id);

alter table scenic_teams enable row level security;
revoke all on scenic_teams from anon, authenticated;
revoke all on sequence scenic_teams_id_seq from anon, authenticated;
