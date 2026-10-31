-- Organization Owners (SPEC.md section 14): manage the organization's Admins; set on the CourtCaptain page.
-- An Owner also holds Admin and Director. Every organization keeps at least one Owner.
alter table org_role_types drop constraint org_role_types_role_check;
alter table org_role_types add constraint org_role_types_role_check
  check (role in ('Request', 'Coach', 'Director', 'Partner', 'Solo', 'Admin', 'Owner'));
insert into org_role_types (org, role) values ('thunder', 'Owner'), ('scenic-city', 'Owner');

-- To start: CourtCaptain Admins who are an organization's Admin become its Owner.
insert into org_roles (coach_id, org, role, granted_by)
select r.coach_id, r.org, 'Owner', 'setup' from org_roles r join platform_admins p using (coach_id) where r.role = 'Admin'
on conflict do nothing;
