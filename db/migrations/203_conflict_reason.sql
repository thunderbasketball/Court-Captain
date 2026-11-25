-- Roster conflicts: why the League allowed a player on two rosters (shown to the League, its organizations and the teams).
set local lock_timeout = '5s';
alter table roster_conflict_reviews add column reason text check (char_length(reason) between 3 and 200);
