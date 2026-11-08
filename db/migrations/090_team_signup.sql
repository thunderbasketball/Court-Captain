-- Team registration from an organization's login page (SPEC.md section 13): an outside coach registers a team, verifies
-- their email with a code, and gets a login (PIN). The code's purpose is 'team'.
alter table email_codes drop constraint email_codes_purpose_check;
alter table email_codes add constraint email_codes_purpose_check check (purpose in ('signup', 'starter', 'verify', 'reset', 'team'));

-- A team's other staff (optional): Assistant Coach, Manager, Team Parent. Contact only (no login); never shown publicly.
create table scenic_team_staff (
  id          bigserial primary key,
  team_id     bigint not null references scenic_teams(id) on delete cascade,
  role        text not null check (role in ('AsstCoach', 'Manager', 'TeamParent')),
  first_name  text not null,
  last_name   text not null,
  cell        text not null,
  email       text,
  added_by    text not null,
  added_at    timestamptz not null default now(),
  unique (team_id, role)
);
alter table scenic_team_staff enable row level security;
revoke all on scenic_team_staff from anon, authenticated;
revoke all on sequence scenic_team_staff_id_seq from anon, authenticated;
