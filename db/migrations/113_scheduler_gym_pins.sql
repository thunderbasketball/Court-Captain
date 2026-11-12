-- A CourtSync Scheduler's own pin for a gym its games use (SPEC.md section 14, Facilities). The host organization sets
-- its gym's location (Google place and/or Directions pin); the Scheduler can use it as is or override Directions on its
-- own schedules with this pin. gym_key: 'o<gyms.id>' (a host organization's gym) or 'p<partner_gyms.id>' (a gym the
-- Scheduler typed in for an outside host, which has no location of its own).
create table scheduler_gym_pins (
  org       text not null references organizations(slug) on update cascade on delete cascade,
  gym_key   text not null check (gym_key ~ '^[op][0-9]+$'),
  pin_lat   double precision not null check (pin_lat between -90 and 90),
  pin_lng   double precision not null check (pin_lng between -180 and 180),
  label     text not null check (length(label) between 1 and 200),
  set_by    text not null,
  set_at    timestamptz not null default now(),
  primary key (org, gym_key)
);
alter table scheduler_gym_pins enable row level security;
revoke all on scheduler_gym_pins from anon, authenticated;
