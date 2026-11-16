-- Each fee of a player program can have its own season end date (Local, Regional and National seasons end at different
-- times); null = the program's end date (SPEC.md section 14).
alter table program_fee_levels add column ends_on date;
