-- A registered organization's team staff can also be a Team Manager or Team Parent, like Thunder's (SPEC.md section 14).
-- Only Head and Assistant Coaches get the organization's Coach role; the others are on the team's Staff card.
alter table org_team_coaches drop constraint org_team_coaches_role_check;
alter table org_team_coaches add constraint org_team_coaches_role_check
  check (role in ('HeadCoach', 'AsstCoach', 'Manager', 'TeamParent'));
