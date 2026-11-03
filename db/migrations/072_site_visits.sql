-- Site visits (SPEC.md section 14: Home metrics): page views on the website, per organization, per person, per hour.
-- One row per person per hour, counting their page views then. View As and CourtCaptain staff aren't counted.
create table site_visits (
  org       text not null references organizations(slug) on update cascade on delete cascade,
  hour      timestamptz not null,
  coach_id  text not null references users(coach_id) on delete cascade,
  views     int not null default 1,
  primary key (org, hour, coach_id)
);
alter table site_visits enable row level security;
revoke all on site_visits from anon, authenticated;
