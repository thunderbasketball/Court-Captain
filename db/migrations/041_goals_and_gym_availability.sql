-- Thunder Facilities (SPEC.md section 14):
-- 1) "North" / "South" are the two practice halves of one court: they're now "Goal #1" / "Goal #2".
-- 2) Availability is for the whole gym (a date, times and a use), not per court. Practice availability covers both goals.
update courts set name = 'Goal #1' where name = 'North';
update courts set name = 'Goal #2' where name = 'South';

create table gym_availability (
  gym_id  bigint not null references gyms(id) on delete cascade,
  day     date not null,
  use     text not null check (use in ('practice', 'partner', 'in-house')),
  starts  time not null,
  ends    time not null check (ends > starts),
  set_by  text not null,
  set_at  timestamptz not null default now(),
  primary key (gym_id, day)
);
create index gym_availability_day on gym_availability (day);
alter table gym_availability enable row level security;
revoke all on gym_availability from anon, authenticated;

-- What was set per court becomes the gym's (the first court's, by name, when they differ).
insert into gym_availability (gym_id, day, use, starts, ends, set_by, set_at)
select distinct on (c.gym_id, a.day) c.gym_id, a.day, a.use, a.starts, a.ends, a.set_by, a.set_at
from court_availability a join courts c on c.id = a.court_id
order by c.gym_id, a.day, c.name;

drop table court_availability;
