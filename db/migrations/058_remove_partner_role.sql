-- The Scenic City Partner role is retired (SPEC.md section 13): hosting sites and teams come from organizations on
-- CourtCaptain now (Hosting Sites Available, Team Management). Removes the role, its contact links and requests.
delete from org_roles where org = 'scenic-city' and role = 'Partner';
delete from partner_contacts;
delete from access_requests where wants = 'Partner';
