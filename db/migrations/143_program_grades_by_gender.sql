-- A player program's grades for each gender it has (SPEC.md section 14: General card): Boys K–8 and Girls 3–8, say.
-- Levels of play are a team's setting, not a player program's (the levels column is no longer used).
alter table player_programs add column boys_grades text[] not null default '{K,1,2,3,4,5,6,7,8,9,10,11,12}'
  check (boys_grades <@ '{K,1,2,3,4,5,6,7,8,9,10,11,12}');
alter table player_programs add column girls_grades text[] not null default '{K,1,2,3,4,5,6,7,8,9,10,11,12}'
  check (girls_grades <@ '{K,1,2,3,4,5,6,7,8,9,10,11,12}');
update player_programs set boys_grades = case when 'Boys' = any(genders) then grades else '{}' end,
                           girls_grades = case when 'Girls' = any(genders) then grades else '{}' end;
