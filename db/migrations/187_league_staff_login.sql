-- A League team's Assistant Coach (FastBreak, a club, Solo) has a login, like an organization's: their user. Managers and
-- Team Parents stay contact only. Assistant Coaches already entered get theirs when saved again.
alter table scenic_team_staff add column coach_id text references users(coach_id) on delete set null;
create index scenic_team_staff_coach on scenic_team_staff (coach_id) where coach_id is not null;
