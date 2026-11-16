-- CourtPlaybook: the organization's own playbook (a play with no team), kept by its Owners and Admins; and a team's
-- play shared with the organization (who shared it, when), which its teams' coaches can copy (SPEC.md section 14).
alter table plays drop constraint plays_check;
alter table plays add constraint plays_owner check (
  (thunder_team_id is null and org_team_id is null)
  or ((org = 'thunder') = (thunder_team_id is not null) and (thunder_team_id is null) <> (org_team_id is null))
);
alter table plays add column shared_by text, add column shared_at timestamptz;
-- A play's name is unique in the organization's own playbook too.
create unique index plays_own_name on plays (org, lower(name)) where thunder_team_id is null and org_team_id is null;
