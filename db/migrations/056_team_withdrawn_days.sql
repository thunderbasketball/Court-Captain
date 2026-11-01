-- A team can withdraw from one of its dates (or the Brackets) and re-enter it (SPEC.md section 14). by_team: the team
-- did it (it can undo it); otherwise a Scenic City Admin or Director of Scheduling did (only they restore it).
alter table scenic_team_off add column by_team boolean not null default false;
