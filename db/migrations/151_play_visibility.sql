-- CourtPlaybook: who sees each play (SPEC.md section 14).
--   private: only the person who made it (made_by);
--   team:    the team's coaches (and, next, its players and parents);
--   org:     the organization's library (its teams' coaches copy it);
--   public:  every organization with CourtPlaybook can see and copy it.
-- The organization's own plays (no team) are never 'team' (read as 'org'). shared_by / shared_at now record who last
-- set who sees it. Plays made before this keep how they worked: shared ones are 'org', the rest 'team'.
alter table plays
  add column visibility text not null default 'team' check (visibility in ('private', 'team', 'org', 'public')),
  add column made_by text;
update plays set visibility = 'org' where shared_by is not null or (thunder_team_id is null and org_team_id is null);
create index plays_public on plays (visibility) where visibility = 'public';
