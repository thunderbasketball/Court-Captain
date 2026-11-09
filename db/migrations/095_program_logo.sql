-- A program's own logo (SPEC.md section 13): shown on its card, its page, the login page's event list and the public
-- League page. PNG, JPEG or WebP up to 512 KB, like an organization's.
alter table scenic_programs
  add column logo bytea check (octet_length(logo) <= 524288),
  add column logo_type text check (logo_type in ('image/png', 'image/jpeg', 'image/webp')),
  add column logo_updated_by text,
  add column logo_updated_at timestamptz;
