-- Scenic City Leagues: a Pre-K (ages 3 and 4) Coed division (SPEC.md section 13). Grade -1 is Pre-K; gender 'Coed' is
-- only for Pre-K and Pre-K is only Coed, REC, one grade (no Pre-K/K teams). For Scenic City's teams, divisions and
-- grade groups, and organizations' own teams (which they register into Leagues). Thunder's teams and TeamSnap players
-- are unchanged.
alter table scenic_teams drop constraint scenic_teams_check, drop constraint scenic_teams_gender_check,
  drop constraint scenic_teams_grade_low_check;
alter table scenic_teams
  add constraint scenic_teams_grades check (grade_low between -1 and 12 and grade between -1 and 12 and grade - grade_low in (0, 1)),
  add constraint scenic_teams_gender_check check (gender in ('Boys', 'Girls', 'Coed')),
  add constraint scenic_teams_prek check ((gender = 'Coed') = (grade = -1) and (grade <> -1 or (grade_low = -1 and level = 'REC')));

alter table org_teams drop constraint org_teams_check, drop constraint org_teams_gender_check,
  drop constraint org_teams_grade_low_check;
alter table org_teams
  add constraint org_teams_grades check (grade_low between -1 and 12 and grade between -1 and 12 and grade - grade_low in (0, 1)),
  add constraint org_teams_gender_check check (gender in ('Boys', 'Girls', 'Coed')),
  add constraint org_teams_prek check ((gender = 'Coed') = (grade = -1) and (grade <> -1 or (grade_low = -1 and level = 'REC')));

alter table scenic_divisions drop constraint scenic_divisions_check, drop constraint scenic_divisions_gender_check,
  drop constraint scenic_divisions_grade_low_check;
alter table scenic_divisions
  add constraint scenic_divisions_grades check (grade_low between -1 and 12 and grade_high between -1 and 12 and grade_high >= grade_low),
  add constraint scenic_divisions_gender_check check (gender in ('Boys', 'Girls', 'Coed')),
  add constraint scenic_divisions_prek check ((gender = 'Coed') = (grade_low = -1) and (gender <> 'Coed' or grade_high = -1));

alter table scenic_grade_groups drop constraint scenic_grade_groups_grade_check;
alter table scenic_grade_groups add constraint scenic_grade_groups_grade_check check (grade between -1 and 12 and (grade <> -1 or level = 'REC'));

alter table org_team_players drop constraint org_team_players_grade_check;
alter table org_team_players add constraint org_team_players_grade_check check (grade between -1 and 12);
