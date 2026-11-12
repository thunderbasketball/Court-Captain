-- Tryout sign-up dates (SPEC.md section 14, step 2c-2): when players can join a tryout's list (free). Tryouts only.
alter table events
  add column signup_opens date,
  add column signup_closes date,
  add constraint events_signup_dates check (signup_closes is null or signup_opens is null or signup_closes >= signup_opens);
