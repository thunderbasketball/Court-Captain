-- The hours each partner court is open on a Scenic City game day (SPEC.md section 13, step 5b). Eastern time.
create table court_hours (
  court_id     bigint not null references partner_courts(id) on delete cascade,
  game_day_id  bigint not null references game_days(id) on delete cascade,
  starts       time not null,
  ends         time not null check (ends > starts),
  set_by       text not null,
  set_at       timestamptz not null default now(),
  primary key (court_id, game_day_id)
);
create index court_hours_day on court_hours(game_day_id);

alter table court_hours enable row level security;
revoke all on court_hours from anon, authenticated;
