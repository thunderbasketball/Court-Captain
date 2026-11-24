-- Roster conflicts (SPEC.md section 13): what a League's directors decided about two roster entries that look like the same
-- player. `pair` is a hash of both entries (team, name and birthdate), so changing either brings it back to be looked at;
-- no names are kept here.
create table roster_conflict_reviews (
  program_id  bigint not null references scenic_programs(id) on delete cascade,
  pair        text not null check (pair ~ '^[0-9a-f]{64}$'),
  decision    text not null check (decision in ('different', 'allowed')),
  reviewed_by text not null,
  reviewed_at timestamptz not null,
  primary key (program_id, pair)
);
alter table roster_conflict_reviews enable row level security;
revoke all on roster_conflict_reviews from anon, authenticated;
