-- What's New (SPEC.md section 14; lib/whats-new.ts): the newest version of the app each person has looked at. The versions
-- and what's in them live in the app's code.
create table whats_new_seen (
  coach_id text primary key references users(coach_id) on delete cascade,
  version  text not null check (version ~ '^[0-9]{1,4}\.[0-9]{1,4}$'),
  seen_at  timestamptz not null
);
alter table whats_new_seen enable row level security;
revoke all on whats_new_seen from anon, authenticated;
