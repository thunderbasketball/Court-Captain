-- The Level "Experience" is "Experienced" (SPEC.md section 14, step 4c).
alter table org_officials drop constraint org_officials_level_check;
update org_officials set level = 'Experienced' where level = 'Experience';
alter table org_officials add constraint org_officials_level_check check (level in ('Certified', 'Experienced', 'Student', 'Recruit'));
