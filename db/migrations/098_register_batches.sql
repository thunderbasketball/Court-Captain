-- "Register all" batches: which registrations one Register all made, so it can be undone (SPEC: Registering teams).
-- `org`: whose teams (an organization's slug, 'thunder', or 'scenic-city' for Scenic City's own Register all).
create table scenic_register_batches (
  id          bigserial primary key,
  program_id  bigint not null references scenic_programs(id) on delete cascade,
  org         text not null,
  teams       int not null,
  done_by     text not null,
  done_by_id  text not null, -- their CoachID (Scenic City's own Register all: they may undo it)
  done_at     timestamptz not null default now(),
  undone_by   text,
  undone_at   timestamptz
);
create index scenic_register_batches_program on scenic_register_batches (program_id, org);

alter table scenic_registrations
  add column batch_id bigint references scenic_register_batches(id) on delete set null;
create index scenic_registrations_batch on scenic_registrations (batch_id) where batch_id is not null;

alter table scenic_register_batches enable row level security;
revoke all on scenic_register_batches from anon, authenticated;
revoke all on sequence scenic_register_batches_id_seq from anon, authenticated;
