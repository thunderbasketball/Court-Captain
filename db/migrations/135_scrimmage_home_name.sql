-- Scrimmages: either side may be an outside team typed in (home_name, like away_name), one of the organization's
-- teams, or TBD.
alter table scrimmages add column home_name text check (length(home_name) between 1 and 60);
alter table scrimmages drop constraint scrimmages_home;
alter table scrimmages add constraint scrimmages_home check (num_nonnulls(home_thunder_team_id, home_org_team_id, home_name) <= 1);
