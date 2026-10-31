-- Scenic City (SPEC.md section 13, step 6b): teams get a level (COMP or REC); divisions become a gender, a grade range
-- and a level (e.g. Boys 3rd–4th COMP). A team joins the division matching its gender, level and (higher) grade.
-- Divisions in a program can't overlap (checked by the app in a transaction).

alter table scenic_teams add column level text not null default 'REC' check (level in ('COMP', 'REC'));
alter table scenic_teams alter column level drop default;

alter table scenic_divisions rename column grade to grade_high;
alter table scenic_divisions add column grade_low smallint;
update scenic_divisions set grade_low = grade_high;
alter table scenic_divisions alter column grade_low set not null;
alter table scenic_divisions add constraint scenic_divisions_range check (grade_low between 0 and 12 and grade_low <= grade_high);
alter table scenic_divisions add column level text not null default 'REC' check (level in ('COMP', 'REC'));
alter table scenic_divisions alter column level drop default;
alter table scenic_divisions drop constraint scenic_divisions_program_id_gender_grade_key;
alter table scenic_divisions add constraint scenic_divisions_one unique (program_id, gender, level, grade_low);
