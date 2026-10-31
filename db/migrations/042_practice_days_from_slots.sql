-- Thunder Facilities (SPEC.md section 14): the practice slots already scheduled (today on) show as Practice days on
-- each gym's availability calendar, from the day's first slot to the end of its last one. Days already set are left alone.
insert into gym_availability (gym_id, day, use, starts, ends, set_by)
select c.gym_id, (s.starts_at at time zone 'America/New_York')::date as day, 'practice',
       min((s.starts_at at time zone 'America/New_York')::time),
       max((s.starts_at at time zone 'America/New_York')::time) + interval '1 hour',
       'setup'
from slots s join courts c on c.id = s.court_id join gyms g on g.id = c.gym_id
where g.active and (s.starts_at at time zone 'America/New_York')::date >= (now() at time zone 'America/New_York')::date
group by c.gym_id, (s.starts_at at time zone 'America/New_York')::date
on conflict (gym_id, day) do nothing;
