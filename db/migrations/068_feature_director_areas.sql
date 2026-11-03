-- One Director area per feature (SPEC.md section 14): Teams, Players, Uniforms, Facilities, Practices, Events, Support,
-- plus the league areas (Programs, Scheduling, Officials). Coaches folds into Teams; Uniforms splits from Players,
-- Practices from Facilities, and Events from Programs. The old keys stay allowed until the matching code is live.
alter table director_areas drop constraint director_areas_area_check;
alter table director_areas add constraint director_areas_area_check
  check (area in ('players', 'teams', 'coaches', 'facilities', 'programs', 'officials', 'scheduling',
                  'uniforms', 'practices', 'events', 'support'));

-- Everyone keeps what they could do: the new area that took over part of an old one.
insert into director_areas (coach_id, org, area, granted_by, granted_at)
select a.coach_id, a.org, x.area, a.granted_by, a.granted_at
from director_areas a
join (values ('players', 'uniforms'), ('facilities', 'practices'), ('coaches', 'teams')) as x(old, area) on x.old = a.area
on conflict do nothing;
-- Thunder has no leagues: its Directors of Programs ran Events (the old row goes once this code is live).
insert into director_areas (coach_id, org, area, granted_by, granted_at)
select coach_id, org, 'events', granted_by, granted_at from director_areas where area = 'programs' and org = 'thunder'
on conflict do nothing;
