-- A birthday fixed in the app (SPEC.md section 14, To remove later: until registrations are taken in the app). The sheet
-- sync replaces registrations, so the fix lives here and is put back after every sync. sheet_birthdate: what the sheet
-- said (shown, and restored when the fix is removed). Once the sheet says the same date, the fix is dropped.
-- No foreign key: registrations are replaced on each sync.
create table birthdate_fixes (
  registrant_id   text primary key,
  birthdate       date not null,
  sheet_birthdate date,
  set_by          text not null,
  set_at          timestamptz not null default now()
);
alter table birthdate_fixes enable row level security;
revoke all on birthdate_fixes from anon, authenticated;
