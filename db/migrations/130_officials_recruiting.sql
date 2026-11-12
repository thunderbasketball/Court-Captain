-- Officials applications (SPEC.md section 14, step 4c): an organization with CourtOfficials turns on Accept recruits (its
-- Officials card); then "Apply to officiate" shows on its login page (an Officials Group's on the league it officiates
-- for). Applicants join its officials as Recruits, with what they wrote, for the Assigner to set their level.
alter table organizations add column accepts_recruits boolean not null default false;
alter table org_officials add column applied_at timestamptz;
alter table org_officials add column application text check (length(application) <= 500);
