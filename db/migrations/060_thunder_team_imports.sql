-- Thunder's teams can be imported too (SPEC.md section 14); each import is a batch in org_team_imports (org 'thunder')
-- so it can be undone.
alter table teams add column import_id bigint references org_team_imports(id) on delete set null;
