-- A TBD's opponent filled in by hand: another team of the division (REC or COMP) playing an extra game. team_a is the team that
-- needed an opponent (the game's level is its level), team_b the fill-in. Who and when. Other games keep the lower id first.
set local lock_timeout = '5s';
alter table scenic_matchups add column fill_team bigint, add column filled_by text, add column filled_at timestamptz;
alter table scenic_matchups drop constraint scenic_matchups_check;
alter table scenic_matchups add constraint scenic_matchups_order check (team_a < team_b or (fill_team is not null and team_a <> team_b));
alter table scenic_matchups add constraint scenic_matchups_fill check (fill_team is null or fill_team = team_b);
