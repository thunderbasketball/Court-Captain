-- Removal from an event's schedule (SPEC.md section 13): a team already in an event's matchups can't withdraw or be
-- deleted; it asks the League's Scheduler to take it off the schedule. Approved: TBD takes its place in its games and it
-- is withdrawn; declined: it stays. Who asked and who decided are recorded.
create table scenic_schedule_removals (
  id           bigserial primary key,
  program_id   bigint not null references scenic_programs(id) on delete cascade,
  team_id      bigint not null references scenic_teams(id) on delete cascade,
  requested_by text not null,
  requested_at timestamptz not null,
  decision     text check (decision in ('approved', 'declined')),
  decided_by   text,
  decided_at   timestamptz
);
-- One open request per team and event.
create unique index scenic_schedule_removals_open on scenic_schedule_removals (program_id, team_id) where decision is null;
alter table scenic_schedule_removals enable row level security;
revoke all on scenic_schedule_removals from anon, authenticated;
revoke all on sequence scenic_schedule_removals_id_seq from anon, authenticated;
