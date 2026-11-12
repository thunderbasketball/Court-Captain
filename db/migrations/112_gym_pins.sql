-- A gym's hand-set pin (SPEC.md section 14, Facilities), kept apart from its Google place: the card shows the Google
-- address; Directions go to the pin when there is one (the right door or parking lot), else to the Google place.
alter table gyms
  add column pin_lat double precision check (pin_lat between -90 and 90),
  add column pin_lng double precision check (pin_lng between -180 and 180),
  add column pin_address text check (length(pin_address) <= 200),
  add column pin_set_by text,
  add column pin_set_at timestamptz;
-- Locations set by hand so far (no Google place) move to the pin.
update gyms set pin_lat = lat, pin_lng = lng, pin_address = address, pin_set_by = place_set_by, pin_set_at = place_set_at,
                address = null, lat = null, lng = null, place_set_by = null, place_set_at = null
where place_id is null and lat is not null;
