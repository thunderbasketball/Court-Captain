-- A League's rules as a page in the app (SPEC.md section 13): its Google Doc's text (Markdown), read by the app's Google
-- account when a Director of Programs refreshes it (or saves the link), shown at /rules/<program> with a search. Who
-- refreshed it and when.
set local lock_timeout = '5s';
alter table scenic_programs
  add column rules_md text check (char_length(rules_md) <= 300000),
  add column rules_md_by text,
  add column rules_md_at timestamptz;
