-- Who set a player's uniform number on a typed-in roster (an organization's, or a League team's), and when.
alter table org_team_players add column jersey_by text, add column jersey_at timestamptz;
alter table scenic_team_players add column jersey_by text, add column jersey_at timestamptz;
