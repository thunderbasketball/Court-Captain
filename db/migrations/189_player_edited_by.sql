-- Typed-in rosters: who last fixed a player's name or grade (SPEC.md section 14), and a League-kept player's birthdate.
alter table org_team_players add column edited_by text, add column edited_at timestamptz;
alter table scenic_team_players add column edited_by text, add column edited_at timestamptz;
