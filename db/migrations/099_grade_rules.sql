-- Grade requirements (SPEC.md section 5, Grade eligibility): a League program's and an organization's age control date,
-- oldest age and age exception, as {"month":8,"day":1,"oldest":8,"exception":7} (ages as grade + n; exception null = none).
-- Null = the default (Aug 1 after the school year; not G + 8; exception not G + 7). An organization can adopt its
-- League's requirements instead (adopt_league_grades), which greys its own out.
alter table scenic_programs
  add column grade_rules jsonb,
  add column grade_rules_by text,
  add column grade_rules_at timestamptz;
alter table organizations
  add column grade_rules jsonb,
  add column adopt_league_grades boolean not null default false,
  add column grade_rules_by text,
  add column grade_rules_at timestamptz;
