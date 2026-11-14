-- Director roles an organization uses (SPEC.md section 14): each feature brings its Director roles (areas); an
-- organization's Admins switch each one Active or off in its gear. No row: active. A role that's off isn't offered for
-- new Directors and gives no access (the Directors who hold it keep it on record, for when it's back on); Admins still
-- have every area.
create table org_area_settings (
  org     text not null references organizations(slug) on update cascade on delete cascade,
  area    text not null,
  active  boolean not null,
  set_by  text not null,
  set_at  timestamptz not null default now(),
  primary key (org, area)
);
alter table org_area_settings enable row level security;
revoke all on org_area_settings from anon, authenticated;

-- The Director areas that count: an organization's switched-off roles left out.
create view active_director_areas as
  select a.* from director_areas a
   where not exists (select 1 from org_area_settings s where s.org = a.org and s.area = a.area and not s.active);
revoke all on active_director_areas from anon, authenticated;
