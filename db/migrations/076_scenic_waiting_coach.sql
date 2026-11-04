-- Scenic City's outside clubs, like every organization (SPEC.md section 14): a Head Coach imported with first and last
-- name only waits on the team (no login yet). The team shows COACH CELL MUST BE ENTERED until Edit adds their cell.
alter table scenic_teams
  add column coach_first text,
  add column coach_last text,
  add constraint scenic_teams_waiting_coach check ((coach_first is null) = (coach_last is null));
