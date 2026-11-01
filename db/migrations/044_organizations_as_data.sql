-- Organizations register on CourtCaptain (SPEC.md section 14). An organization's look and type are data now:
-- short name, type, color and logo (a file in public/ for the first two, or an uploaded image stored here).
alter table organizations add column short_name text;
alter table organizations add column kind text not null default 'Organization'
  check (kind in ('Organization', 'School', 'Club', 'League'));
alter table organizations add column color text not null default '#1d4ed8' check (color ~ '^#[0-9a-f]{6}$');
alter table organizations add column logo_path text;          -- a file in public/, e.g. /brand/logo-96.png
alter table organizations add column big_logo_path text;
alter table organizations add column logo bytea check (octet_length(logo) <= 524288);
alter table organizations add column logo_type text check (logo_type in ('image/png', 'image/jpeg', 'image/webp'));
alter table organizations add column created_by text;
alter table organizations add column logo_updated_at timestamptz;

update organizations set short_name = 'Thunder', kind = 'Club', color = '#f97316',
  logo_path = '/brand/logo-96.png', big_logo_path = '/brand/logo-256.png', created_by = 'setup' where slug = 'thunder';
update organizations set short_name = 'Scenic City', kind = 'League', color = '#13294b',
  logo_path = '/brand/scenic-city-192.png', big_logo_path = '/brand/scenic-city-512.png', created_by = 'setup' where slug = 'scenic-city';
alter table organizations alter column short_name set not null;

-- Features a new organization asked for that aren't ready for it yet (shown on its Features page).
create table org_feature_requests (
  org         text not null references organizations(slug) on delete cascade,
  feature     text not null check (feature ~ '^[a-z-]+$'),
  asked_by    text not null,
  asked_at    timestamptz not null default now(),
  primary key (org, feature)
);
alter table org_feature_requests enable row level security;
revoke all on org_feature_requests from anon, authenticated;
