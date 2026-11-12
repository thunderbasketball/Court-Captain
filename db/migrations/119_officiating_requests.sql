-- CourtSync officiating (SPEC.md section 14, step 4c): an Officials Group asks a league (a CourtSync Scheduler with
-- CourtTeams) to officiate its games; the league's Admins or Directors of Scheduling or Programs approve or decline.
-- Kept apart from org_partnerships (hosting) so hosting stays as it is.
create table officiating_partnerships (
  id             bigserial primary key,
  officials_org  text not null references organizations(slug) on update cascade on delete cascade,
  for_org        text not null references organizations(slug) on update cascade on delete cascade,
  status         text not null check (status in ('pending', 'approved', 'declined')),
  requested_by   text not null,
  requested_at   timestamptz not null default now(),
  decided_by     text,
  decided_at     timestamptz,
  check (officials_org <> for_org),
  unique (officials_org, for_org)
);
alter table officiating_partnerships enable row level security;
revoke all on officiating_partnerships from anon, authenticated;
revoke all on sequence officiating_partnerships_id_seq from anon, authenticated;
