-- CourtCaptain features each organization has (SPEC.md section 14). The list of features lives in lib/features.ts;
-- this table records which ones an organization has turned on (later, by buying an upgrade). Alerts come with every
-- organization and aren't stored.

create table org_features (
  org           text not null references organizations(slug) on delete cascade,
  feature       text not null check (feature ~ '^[a-z-]+$'),
  source        text not null check (source in ('setup', 'purchase', 'comp')),
  turned_on_by  text,
  turned_on_at  timestamptz not null default now(),
  primary key (org, feature)
);

alter table org_features enable row level security;
revoke all on org_features from anon, authenticated;

insert into org_features (org, feature, source, turned_on_by) values
  ('thunder', 'player-registration', 'setup', 'setup'),
  ('thunder', 'team-building', 'setup', 'setup'),
  ('thunder', 'uniforms', 'setup', 'setup'),
  ('thunder', 'practice', 'setup', 'setup'),
  ('thunder', 'events', 'setup', 'setup'),
  ('thunder', 'chat', 'setup', 'setup'),
  ('thunder', 'partner-tools', 'setup', 'setup'),
  ('scenic-city', 'team-registration', 'setup', 'setup'),
  ('scenic-city', 'hosting-partners', 'setup', 'setup'),
  ('scenic-city', 'programs', 'setup', 'setup'),
  ('scenic-city', 'officials', 'setup', 'setup');
