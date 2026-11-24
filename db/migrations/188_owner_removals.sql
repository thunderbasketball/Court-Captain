-- Removing an Owner (SPEC.md section 14): another Owner asks, the Owner is emailed, and stays one until they approve.
create table owner_removals (
  id            bigserial primary key,
  org           text not null references organizations(slug) on update cascade on delete cascade,
  coach_id      text not null references users(coach_id) on delete cascade,
  requested_by  text not null references users(coach_id) on delete cascade,
  requested_name text not null,
  requested_at  timestamptz not null,
  decision      text check (decision in ('approved', 'declined', 'cancelled')),
  decided_by    text,
  decided_at    timestamptz,
  check ((decision is null) = (decided_at is null))
);
create unique index owner_removals_one_waiting on owner_removals (org, coach_id) where decision is null;
alter table owner_removals enable row level security;
revoke all on owner_removals from anon, authenticated;
revoke all on sequence owner_removals_id_seq from anon, authenticated;
