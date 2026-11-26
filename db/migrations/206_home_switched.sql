-- A game's home and away switched by hand (a Director of Scheduling drags one team onto the other): who and when.
set local lock_timeout = '5s';
alter table scenic_matchups add column home_set_by text, add column home_set_at timestamptz;
