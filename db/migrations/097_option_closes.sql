-- Each Registration Option's own close (SPEC.md section 13): on a date, or a number of days before the event (ALL Season:
-- the League's first Game Day; a Single Day option: each Game Day picked). Neither = closes with the program's registration.
alter table scenic_program_options
  add column closes_on date,
  add column closes_days_before smallint check (closes_days_before between 0 and 365),
  add constraint scenic_program_options_one_close check (closes_on is null or closes_days_before is null);
