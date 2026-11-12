-- Scrimmages: either team may be TBD (picked later), so each side holds at most one team (none: TBD).
alter table scrimmages drop constraint scrimmages_check, drop constraint scrimmages_check1;
alter table scrimmages add constraint scrimmages_home check (num_nonnulls(home_thunder_team_id, home_org_team_id) <= 1);
alter table scrimmages add constraint scrimmages_away check (num_nonnulls(away_thunder_team_id, away_org_team_id, away_name) <= 1);
