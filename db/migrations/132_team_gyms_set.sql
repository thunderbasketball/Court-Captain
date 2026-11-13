-- Team Practice Facilities: a team can have no gyms at all (it practices at its own gym only). practice_gyms_set = true
-- means practice_locations is the exact list (empty = none); false = every gym (teams made before this, until a
-- Director sets them). New teams start set with none: the Director of Facilities or Practices gives gym access.
alter table teams add column practice_gyms_set boolean not null default false;
update teams set practice_gyms_set = true where practice_locations <> '{}';
alter table teams alter column practice_gyms_set set default true;
