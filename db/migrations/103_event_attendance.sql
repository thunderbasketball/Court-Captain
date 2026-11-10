-- Attendance on a team's events (SPEC.md section 12, "Team events attendance"): its own-gym practices and League games,
-- for Thunder's teams ("t<id>") and every organization's ("o<id>"). The team's staff mark each player here (✓) or
-- absent (✗); a parent marks whether their player plans to come (rsvp). Booked practices (slots) keep their staff marks
-- in practice_attendance; their parents' rsvp is here. A player is a registration (Thunder) or an org_team_players id.
create table event_attendance (
  kind       text not null check (kind in ('slot', 'own', 'game')),
  event_id   bigint not null,
  team       text not null check (team ~ '^[to][0-9]{1,18}$'),
  player     text not null check (player ~ '^[A-Za-z0-9_-]{1,40}$'),
  status     text not null default 'unknown' check (status in ('unknown', 'here', 'absent')),
  status_by  text,
  status_at  timestamptz,
  rsvp       text check (rsvp in ('yes', 'no')),
  rsvp_by    text,
  rsvp_at    timestamptz,
  primary key (kind, event_id, team, player)
);

alter table event_attendance enable row level security;
revoke all on event_attendance from anon, authenticated;
