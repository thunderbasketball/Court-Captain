-- Find my player's team (public pages): a parent's email code has purpose 'find'.
alter table email_codes drop constraint email_codes_purpose_check;
alter table email_codes add constraint email_codes_purpose_check check (purpose in ('signup', 'starter', 'verify', 'reset', 'team', 'find'));
