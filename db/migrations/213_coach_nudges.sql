-- Reminders to coaches from Home's metrics (SPEC.md section 14): to start using the app, or to finish their team's roster.
-- One row per coach each time: by email (sent by the app) or text (opened in the sender's Messages). Who sent it and when;
-- test: on a test site (only the sender got it).
set local lock_timeout = '5s';
create table coach_nudges (
  id       bigint generated always as identity primary key,
  org      text not null,
  kind     text not null check (kind in ('use', 'rosters')),
  channel  text not null check (channel in ('email', 'text')),
  coach_id text not null,
  sent_by  text not null,
  sent_at  timestamptz not null default now(),
  test     boolean not null default false
);
create index coach_nudges_org on coach_nudges (org, kind, coach_id, sent_at desc);
alter table coach_nudges enable row level security;
revoke all on coach_nudges from anon, authenticated;
