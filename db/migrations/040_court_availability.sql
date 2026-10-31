-- Thunder Facilities (SPEC.md section 14): what each court is available for on each date, and when (Eastern).
-- practice = Practice Slots (needs Practice Management); partner = Partner Games (needs an approved hosting partnership);
-- in-house = In-House Games (needs Programs). One use per court per date.
create table court_availability (
  court_id  bigint not null references courts(id) on delete cascade,
  day       date not null,
  use       text not null check (use in ('practice', 'partner', 'in-house')),
  starts    time not null,
  ends      time not null check (ends > starts),
  set_by    text not null,
  set_at    timestamptz not null default now(),
  primary key (court_id, day)
);
create index court_availability_day on court_availability (day);

alter table court_availability enable row level security;
revoke all on court_availability from anon, authenticated;
