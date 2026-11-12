-- An official's Level is one of four (SPEC.md section 14, step 4c): Certified, Experience, Student, Recruit. Recruits
-- can't be scheduled to officiate games. Anything else typed earlier is matched by name or cleared.
update org_officials set level = initcap(lower(trim(level))) where level is not null;
update org_officials set level = null where level not in ('Certified', 'Experience', 'Student', 'Recruit');
alter table org_officials drop constraint org_officials_level_check;
alter table org_officials add constraint org_officials_level_check check (level in ('Certified', 'Experience', 'Student', 'Recruit'));
