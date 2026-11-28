-- A team's own logo (SPEC.md section 13), set by its Head Coach or Team Manager or its organization's Owners, Admins and
-- Directors of Teams; shown on its Game Day pictures in place of its organization's. One per team, whichever kind:
-- 't:<id>' a Thunder team, 'o:<id>' an organization's team, 's:<id>' a League team of no organization (Solo).
-- PNG, JPEG or WebP up to 512 KB, like an organization's.
set local lock_timeout = '5s';
create table team_logos (
  team_key   text primary key check (team_key ~ '^[tos]:[0-9]{1,18}$'),
  logo       bytea not null check (octet_length(logo) <= 524288),
  logo_type  text not null check (logo_type in ('image/png', 'image/jpeg', 'image/webp')),
  updated_by text not null,
  updated_at timestamptz not null default now()
);
alter table team_logos enable row level security;
revoke all on team_logos from anon, authenticated;
