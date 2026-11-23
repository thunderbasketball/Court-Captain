-- An organization's Default Alternate name (SPEC.md section 14; Organization settings → General, its Admins): in leagues
-- and events, a team without an Alternate name of its own shows it in the organization's place ("5B Thunder Johnson").
-- Team names inside the organization stay as they are. Who set it is recorded.
alter table organizations
  add column default_alt_name text check (default_alt_name is null or length(default_alt_name) between 1 and 30),
  add column default_alt_by text,
  add column default_alt_at timestamptz;
