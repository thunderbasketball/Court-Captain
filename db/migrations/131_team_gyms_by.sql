-- Team Practice Facilities (Facilities → Team Practice Facilities): who last set a team's practice gyms, and when.
-- teams.practice_locations stays the list (empty = every gym).
alter table teams add column practice_locations_by text;
alter table teams add column practice_locations_at timestamptz;
