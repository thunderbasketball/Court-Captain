-- When a League's schedule requests close (SPEC.md section 13), set in its Schedule requests gear: COMP teams' requests
-- for a Game Day close n days before it (null: the Sunday before, as before); REC (and Pre-K) teams' close n days before
-- the League's first Game Day (null: 14, as before).
alter table scenic_request_settings
  add column comp_days_before smallint check (comp_days_before between 0 and 30),
  add column rec_days_before smallint check (rec_days_before between 0 and 60);
