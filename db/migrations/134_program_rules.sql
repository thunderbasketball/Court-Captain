-- A League's rules (SPEC.md section 13): a PDF its Directors of Programs upload in the program's gear. Hosting
-- organizations find it on their Home's Documents card (with a blank scoresheet and their Game Days' scoresheets).
alter table scenic_programs add column rules bytea;
alter table scenic_programs add column rules_name text check (char_length(rules_name) <= 120);
alter table scenic_programs add column rules_by text;
alter table scenic_programs add column rules_at timestamptz;
