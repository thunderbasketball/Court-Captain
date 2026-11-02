-- Thunder registers its teams into Scenic City programs too (SPEC.md section 14), like other organizations: each gets a
-- copy in Scenic City ("TB 4G Epps") under Thunder's partner record, read-only there, removed with the team.
alter table scenic_teams add column thunder_team_id bigint unique references teams(id) on delete cascade;
