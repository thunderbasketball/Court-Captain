-- Alerts (announcements) for every organization (SPEC.md section 11): each one belongs to the organization it was sent
-- from; its Directors send it to that organization's people. Earlier ones are Thunder's (the default keeps the live
-- site's older code sending Thunder's). Follows a renamed organization and goes with a deleted one.
alter table announcements
  add column org text not null default 'thunder' references organizations(slug) on update cascade on delete cascade;
create index announcements_org on announcements (org, created_at desc);
