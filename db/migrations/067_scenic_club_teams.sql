-- Scenic City adds and imports teams for outside clubs (organizations not on CourtCaptain; SPEC.md section 13). Each club
-- has an Abbreviation for its teams' league names ("HH 5B Harris"); teams get an optional Alternate name; each Import is
-- a batch that can be undone. Additive only: the live site's older code ignores these.
alter table partners add column abbr text check (abbr ~ '^[A-Za-z0-9]{1,6}$');
alter table scenic_teams add column alt_name text;

create table scenic_team_imports (
  id           bigserial primary key,
  imported_by  text not null,
  imported_at  timestamptz not null default now(),
  teams        integer not null,
  undone_by    text,
  undone_at    timestamptz
);
create index scenic_team_imports_at on scenic_team_imports (imported_at desc);
alter table scenic_teams add column import_id bigint references scenic_team_imports(id) on delete set null;

alter table scenic_team_imports enable row level security;
revoke all on scenic_team_imports from anon, authenticated;
revoke all on sequence scenic_team_imports_id_seq from anon, authenticated;
