-- Director of Coaches (SPEC.md section 14): the Coaches page (coach contacts, parents who volunteered to coach).
alter table director_areas drop constraint director_areas_area_check;
alter table director_areas add constraint director_areas_area_check
  check (area in ('players', 'teams', 'coaches', 'facilities', 'programs', 'officials'));
