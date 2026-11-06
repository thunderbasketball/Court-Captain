-- Scheduler → Bindings (SPEC.md section 13): teams a Scheduler binds by hand, linked like teams sharing a coach (all home
-- or all away, one badge, never two games at once). A binding has 2+ teams and an optional reason.
create table scenic_bindings (
  id      bigserial primary key,
  reason  text check (char_length(reason) <= 80),
  set_by  text not null,
  set_at  timestamptz not null default now()
);
create table scenic_binding_teams (
  binding_id  bigint not null references scenic_bindings(id) on delete cascade,
  team_id     bigint not null references scenic_teams(id) on delete cascade,
  primary key (binding_id, team_id)
);
create index scenic_binding_teams_team on scenic_binding_teams (team_id);
alter table scenic_bindings enable row level security;
alter table scenic_binding_teams enable row level security;
revoke all on scenic_bindings, scenic_binding_teams from anon, authenticated;
revoke all on sequence scenic_bindings_id_seq from anon, authenticated;
