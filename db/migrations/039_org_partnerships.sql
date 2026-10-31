-- Organizations partnering with each other (SPEC.md section 14): an organization with "Hosting Sites Available" asks one
-- with "Hosting Sites Wanted" to host its games; when approved, it becomes that organization's hosting partner (a
-- partners row linked to the organization, so its own Directors of Facilities manage it instead of named contacts).

insert into org_features (org, feature, source, turned_on_by) values ('thunder', 'hosting-available', 'setup', 'setup')
on conflict do nothing;

alter table partners add column org_slug text unique references organizations(slug);

create table org_partnerships (
  id           bigserial primary key,
  host_org     text not null references organizations(slug),  -- offers its gyms (e.g. Thunder)
  for_org      text not null references organizations(slug),  -- wants hosting sites (e.g. Scenic City)
  status       text not null check (status in ('pending', 'approved', 'declined')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  decided_by   text,
  decided_at   timestamptz,
  partner_id   bigint references partners(id) on delete set null,
  check (host_org <> for_org),
  unique (host_org, for_org)
);

alter table org_partnerships enable row level security;
revoke all on org_partnerships from anon, authenticated;
revoke all on sequence org_partnerships_id_seq from anon, authenticated;
