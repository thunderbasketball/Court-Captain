-- A Game Day's Custom times as break points (SPEC.md section 13): each starts slots of its own length, until the next
-- break point (the last: until the hosts close), at every gym that day. Replaces the single list of start times
-- (slot_times, no longer used).
alter table game_days add column slot_breaks jsonb check (slot_breaks is null or jsonb_typeof(slot_breaks) = 'array');
update game_days set slot_times = null;
