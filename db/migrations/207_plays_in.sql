-- The League places a registered team in another division or grade than its own (it "plays in" it): who, when and why.
-- The team's own gender and grade stay; later changes to the team don't move it back.
set local lock_timeout = '5s';
alter table scenic_registrations add column plays_in_by text, add column plays_in_at timestamptz, add column plays_in_why text;
-- A K-and-up division may be Coed too (Boys and Girls teams); Pre-K stays its own Coed division.
alter table scenic_divisions drop constraint scenic_divisions_prek;
alter table scenic_divisions add constraint scenic_divisions_prek check (grade_low <> -1 or (gender = 'Coed' and grade_high = -1));
