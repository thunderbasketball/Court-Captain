-- CourtPlaybook Base Formations (SPEC.md section 14): a playbook's Offense and Defense plays are grouped by the formation
-- they start from. Common formations are built into the app (lib/play-formations.ts); a playbook's own are kept here:
-- a name and where the players stand (`spots`: one drawing frame, no lines). One with a built-in's name replaces it in
-- that playbook. A team's, or (no team) the organization's own; who added and changed each is recorded.
create table play_formations (
  id              bigserial primary key,
  org             text not null references organizations(slug) on update cascade on delete cascade,
  thunder_team_id bigint references teams(id) on delete cascade,
  org_team_id     bigint references org_teams(id) on delete cascade,
  kind            text not null check (kind in ('Offense', 'Defense')),
  name            text not null check (length(name) between 1 and 40),
  spots           jsonb not null,
  added_by        text not null,
  added_at        timestamptz not null default now(),
  updated_by      text,
  updated_at      timestamptz,
  check (
    (thunder_team_id is null and org_team_id is null)
    or ((org = 'thunder') = (thunder_team_id is not null) and (thunder_team_id is null) <> (org_team_id is null))
  )
);
create unique index play_formations_thunder on play_formations (thunder_team_id, kind, lower(name)) where thunder_team_id is not null;
create unique index play_formations_org_team on play_formations (org_team_id, kind, lower(name)) where org_team_id is not null;
create unique index play_formations_own on play_formations (org, kind, lower(name)) where thunder_team_id is null and org_team_id is null;

alter table play_formations enable row level security;
revoke all on play_formations from anon, authenticated;
revoke all on sequence play_formations_id_seq from anon, authenticated;

-- The formation an Offense or Defense play starts from (its name; none = "Other").
alter table plays add column formation text check (length(formation) between 1 and 40);
