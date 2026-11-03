-- Finishes 068 now that its code is live: the old Coaches area (folded into Teams) and Thunder's old Programs area
-- (Thunder's Directors of Programs ran Events, copied to 'events') go. Leagues keep Programs.
delete from director_areas where area = 'coaches';
delete from director_areas where area = 'programs' and org = 'thunder';
alter table director_areas drop constraint director_areas_area_check;
alter table director_areas add constraint director_areas_area_check
  check (area in ('players', 'teams', 'facilities', 'programs', 'officials', 'scheduling',
                  'uniforms', 'practices', 'events', 'support'));
