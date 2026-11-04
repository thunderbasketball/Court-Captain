-- Scenic City Scheduler Grid (SPEC.md section 13, step 7): each Game Day's game length, in minutes (55 unless the
-- Scheduler changes it). The Grid splits each gym's open hours into blocks of this length.
alter table game_days
  add column game_minutes smallint not null default 55 check (game_minutes between 20 and 180),
  add column game_minutes_set_by text;
