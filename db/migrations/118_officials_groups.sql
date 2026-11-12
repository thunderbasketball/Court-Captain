-- Officials Group: a new type of organization (SPEC.md section 14, step 4c). It keeps its officials (org_officials) with
-- CourtOfficials and works leagues' games through CourtSync.
alter table organizations drop constraint organizations_kind_check;
alter table organizations add constraint organizations_kind_check check (kind in ('Organization', 'School', 'Club', 'League', 'Team', 'Officials'));
