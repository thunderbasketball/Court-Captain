-- A League's own schedule request blocks and limit (SPEC.md section 13): its Schedule requests gear (Directors of
-- Programs or Scheduling). Without a row, the 4 blocks 9–12, 12–3, 3–6, 6–9 and up to 2. Who set it is recorded.
create table scenic_request_settings (
  program_id  bigint primary key references scenic_programs(id) on delete cascade,
  blocks      jsonb not null,                -- [{ "key": "09", "label": "9 AM–12 PM", "start": 540, "end": 720 }], sorted
  max_blocked integer not null check (max_blocked between 1 and 7),
  set_by      text not null,
  set_at      timestamptz not null default now()
);
alter table scenic_request_settings enable row level security;
revoke all on scenic_request_settings from anon, authenticated;

-- A team's request now names the League's own blocks (their start: "09", "0930"), up to 7.
alter table scenic_schedule_requests drop constraint scenic_schedule_requests_blocks_check;
alter table scenic_schedule_requests add constraint scenic_schedule_requests_blocks_check
  check (cardinality(blocks) <= 7 and array_to_string(blocks, ',') ~ '^([0-9]{2}([0-9]{2})?(,[0-9]{2}([0-9]{2})?)*)?$');
