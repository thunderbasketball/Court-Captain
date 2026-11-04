-- A Head Coach named without a cell yet (SPEC.md section 14): imported with first and last name only. The team is named
-- for them ("3G Campbell") and shows COACH CELL MUST BE ENTERED; adding their cell makes their login and the Head Coach.
alter table teams
  add column coach_first text,
  add column coach_last text,
  add constraint teams_waiting_coach check ((coach_first is null) = (coach_last is null));
alter table org_teams
  add column coach_first text,
  add column coach_last text,
  add constraint org_teams_waiting_coach check ((coach_first is null) = (coach_last is null));
