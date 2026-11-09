-- CourtSolo (SPEC.md section 14): one active team per account. An archived team stays as history (past games and
-- registrations) but can't register again. A team with its own name (a CourtSolo team, kept when the account switches to
-- CourtOrg) isn't renamed by the grade + gender + coach rule.
alter table org_teams
  add column archived_by text,
  add column archived_at timestamptz,
  add column own_name boolean not null default false;
update org_teams t set own_name = true from organizations o where o.slug = t.org and o.kind = 'Team';
