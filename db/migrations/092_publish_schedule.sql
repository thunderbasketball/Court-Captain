-- Public League page (SPEC.md section 13): a League's schedule shows to the public only once a Director of Programs
-- publishes it (and can unpublish it). Who published it and when is recorded; null = not published.
alter table scenic_programs
  add column schedule_published_by text,
  add column schedule_published_at timestamptz;
