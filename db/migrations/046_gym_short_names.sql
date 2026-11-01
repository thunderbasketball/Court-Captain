-- A gym's short name (e.g. "ERCC") for tight spots on phones. Optional for Thunder's existing gyms; unique within an
-- organization.
alter table gyms add column short_name text;
create unique index gyms_org_short_name on gyms (org, lower(short_name)) where short_name is not null;
