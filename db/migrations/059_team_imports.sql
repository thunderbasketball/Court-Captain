-- Team imports (SPEC.md section 14): each Import is a batch, so it can be undone (its teams removed). Who imported it
-- and who undid it are recorded.
create table org_team_imports (
  id           bigserial primary key,
  org          text not null references organizations(slug) on delete cascade,
  imported_by  text not null,
  imported_at  timestamptz not null default now(),
  teams        integer not null,
  undone_by    text,
  undone_at    timestamptz
);
create index org_team_imports_org on org_team_imports (org, imported_at desc);
alter table org_teams add column import_id bigint references org_team_imports(id) on delete set null;

alter table org_team_imports enable row level security;
revoke all on org_team_imports from anon, authenticated;
revoke all on sequence org_team_imports_id_seq from anon, authenticated;
