-- A League's rules as a link (a Google Doc shared to anyone with the link), beside or instead of its PDF: who set it and when.
set local lock_timeout = '5s';
alter table scenic_programs
  add column rules_url text check (rules_url ~ '^https://' and char_length(rules_url) <= 500),
  add column rules_url_by text,
  add column rules_url_at timestamptz;
-- Scenic City's Winter (26/27) rules (the League's Google Doc).
update scenic_programs set rules_url = 'https://docs.google.com/document/d/1_47RvmPehQM5Z2ZfmOcf11vvTg9j9jaLe93Bv2c11IA/edit?usp=sharing',
       rules_url_by = 'Earl Epps', rules_url_at = now()
 where org = 'scenic-city' and kind = 'League' and name = 'Winter (26/27)';
