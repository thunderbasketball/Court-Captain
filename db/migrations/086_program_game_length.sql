-- Game length per program, with a per-day override (SPEC.md section 13, Scheduler). A program's game length is used on
-- its Game Days unless the day has an override: its own length and/or its own start times (every gym that day).
-- Additive: game_days.game_minutes stays for code already running; new code reads the columns below.
alter table scenic_programs
  add column game_minutes smallint not null default 55 check (game_minutes between 20 and 180),
  add column game_minutes_set_by text;
alter table game_days
  add column minutes_override smallint check (minutes_override between 20 and 180),
  add column slot_times text[] check (slot_times is null or cardinality(slot_times) between 1 and 40),
  add column override_by text;
-- Days whose length was changed by hand become overrides.
update game_days set minutes_override = game_minutes, override_by = game_minutes_set_by where game_minutes_set_by is not null;
