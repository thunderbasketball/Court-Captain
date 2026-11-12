-- CourtSync officials (SPEC.md section 14, step 4c): the referees a CourtSync Scheduler (e.g. Scenic City) puts on its
-- games. Kept by its Admins and Directors of Officials; an official is any user (found by cell, or a login made).
-- CourtOfficials is no longer a separate feature (it's part of CourtSync's Scheduler side).
create table org_officials (
  org       text not null references organizations(slug) on update cascade on delete cascade,
  coach_id  text not null references users(coach_id) on delete cascade,
  added_by  text not null,
  added_at  timestamptz not null default now(),
  primary key (org, coach_id)
);
create index org_officials_coach on org_officials (coach_id);
alter table org_officials enable row level security;
revoke all on org_officials from anon, authenticated;
