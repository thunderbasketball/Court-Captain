-- A typed-in roster's player birthdate (SPEC.md section 14): asked when adding or importing players (organizations
-- without CourtPlayers; with it, birthdates come from registrations). Missing: a warning. Who set it is recorded.
alter table org_team_players
  add column birthdate date check (birthdate between '1990-01-01' and '2035-12-31'),
  add column birthdate_by text,
  add column birthdate_at timestamptz;
