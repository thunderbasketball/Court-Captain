-- Officials for a scrimmage (SPEC.md section 14): the organization ticks "Schedule officials" and picks an Officials Group;
-- the scrimmage then shows on that group's page to be scheduled. Null: no officials.
alter table scrimmages add column officials_org text references organizations(slug) on update cascade on delete set null;
create index scrimmages_officials on scrimmages (officials_org, starts_at) where officials_org is not null;
