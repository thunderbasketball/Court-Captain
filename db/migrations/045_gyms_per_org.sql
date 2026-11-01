-- Hosting for any organization (SPEC.md section 14, step 2): every gym belongs to an organization (Thunder's so far).
-- Gym names are unique within an organization.
alter table gyms add column org text not null default 'thunder' references organizations(slug) on delete cascade;
alter table gyms drop constraint gyms_name_key;
alter table gyms add constraint gyms_org_name_key unique (org, name);
create index gyms_org on gyms (org);
