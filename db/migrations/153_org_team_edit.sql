-- An organization's team can be changed after it's added (gender, grades, level; SPEC.md section 14): who changed it last.
alter table org_teams add column updated_by text, add column updated_at timestamptz;
