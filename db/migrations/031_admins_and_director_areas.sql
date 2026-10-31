-- Organization Admins and Director areas (SPEC.md section 14).
-- Admin: runs the organization and has every area; also holds the Director role, so Director checks keep working.
-- Directors are given areas (Players, Teams, Facilities, Programs, Officials) by their organization's Admins.

alter table org_role_types drop constraint org_role_types_role_check;
alter table org_role_types add constraint org_role_types_role_check
  check (role in ('Request', 'Coach', 'Director', 'Partner', 'Solo', 'Admin'));
insert into org_role_types (org, role) values ('thunder', 'Admin'), ('scenic-city', 'Admin');

create table director_areas (
  coach_id    text not null references users(coach_id) on delete cascade,
  org         text not null references organizations(slug) on delete cascade,
  area        text not null check (area in ('players', 'teams', 'facilities', 'programs', 'officials')),
  granted_by  text not null,
  granted_at  timestamptz not null default now(),
  primary key (coach_id, org, area)
);

alter table director_areas enable row level security;
revoke all on director_areas from anon, authenticated;

-- Today's Directors become their organization's Admins, so nobody loses anything.
insert into org_roles (coach_id, org, role, granted_by)
select coach_id, org, 'Admin', 'setup' from org_roles where role = 'Director'
on conflict do nothing;
