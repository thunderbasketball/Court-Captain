-- Gyms are real places (SPEC.md section 14, Facilities): picked from a Google Places search. Each organization keeps its
-- own gym; the same Google place_id on two organizations' gyms means the same building (for sharing later).
alter table gyms
  add column address text check (length(address) <= 200),
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180),
  add column place_id text check (place_id ~ '^[A-Za-z0-9_-]+$' and length(place_id) between 10 and 300),
  add column place_set_by text,
  add column place_set_at timestamptz;
create index gyms_place on gyms (place_id) where place_id is not null;
