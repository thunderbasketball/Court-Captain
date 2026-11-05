-- Scenic City Facilities → Courts (SPEC.md section 13): which League divisions may play on each court. A court with
-- none listed takes every division; once any is listed, the Scheduler Grid places only those divisions' games there.
-- court_key: the Grid's court id: a partner court's id ("12"), or an organization gym's court ("o3-7", "o3-gym").
create table scenic_court_divisions (
  court_key    text not null check (court_key ~ '^(\d{1,18}|o\d{1,18}-(\d{1,18}|gym))$'),
  division_id  bigint not null references scenic_divisions(id) on delete cascade,
  set_by       text not null,
  set_at       timestamptz not null default now(),
  primary key (court_key, division_id)
);
alter table scenic_court_divisions enable row level security;
revoke all on scenic_court_divisions from anon, authenticated;
