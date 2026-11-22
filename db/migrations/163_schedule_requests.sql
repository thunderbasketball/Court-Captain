-- Schedule requests (SPEC.md section 13): a League turns them on per Game Day; a registered team's coaches block up to
-- 2 of the 4 time blocks that day (9–12, 12–3, 3–6, 6–9). Closes: REC 2 weeks before the League's first Game Day,
-- COMP the Sunday before the Game Day. The Scheduler's Grid never places a team's game in a blocked block; a request
-- that can't be met means the team sits out that day. Who did it recorded.
alter table program_game_days add column requests_by text, add column requests_at timestamptz;

create table scenic_schedule_requests (
  program_id  bigint not null,
  team_id     bigint not null,
  day         date not null,
  blocks      text[] not null check (blocks <@ array['09', '12', '15', '18'] and cardinality(blocks) <= 2),
  set_by      text not null,
  set_at      timestamptz not null default now(),
  primary key (program_id, team_id, day),
  foreign key (program_id, team_id) references scenic_registrations (program_id, team_id) on delete cascade
);
create index scenic_schedule_requests_day on scenic_schedule_requests (day, team_id);
alter table scenic_schedule_requests enable row level security;
revoke all on scenic_schedule_requests from anon, authenticated;
