-- CourtPlaybook (SPEC.md section 14): each team's own plays (Offense, Defense, Inbounds, Drills), seen and changed by
-- its coaches (and the organization's Directors of Teams and Admins). A Thunder team is in teams, another
-- organization's in org_teams (as team_practices). Drawing on a court and sharing with the organization come next.
create table plays (
  id              bigserial primary key,
  org             text not null references organizations(slug) on update cascade on delete cascade,
  thunder_team_id bigint references teams(id) on delete cascade,
  org_team_id     bigint references org_teams(id) on delete cascade,
  name            text not null check (length(name) between 1 and 60),
  kind            text not null check (kind in ('Offense', 'Defense', 'Inbounds', 'Drill')),
  notes           text not null default '' check (length(notes) <= 2000),
  added_by        text not null,
  added_at        timestamptz not null default now(),
  updated_by      text,
  updated_at      timestamptz,
  check ((org = 'thunder') = (thunder_team_id is not null) and (thunder_team_id is null) <> (org_team_id is null))
);
-- A play's name is unique on its team.
create unique index plays_thunder_name on plays (thunder_team_id, lower(name)) where thunder_team_id is not null;
create unique index plays_org_name on plays (org_team_id, lower(name)) where org_team_id is not null;

alter table plays enable row level security;
revoke all on plays from anon, authenticated;
revoke all on sequence plays_id_seq from anon, authenticated;
