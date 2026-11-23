-- The season guide email (SPEC.md section 13): a CourtTeams organization's Owners, Admins or Directors of Teams email
-- the coaches of the teams in its current events how to use CourtCaptain. Each send keeps its recipients (one email per
-- coach, written when it starts) and goes out in small batches, each recipient once; who sent it and when are recorded.
create table org_guide_sends (
  id          bigserial primary key,
  org         text not null references organizations(slug) on update cascade on delete cascade,
  subject     text not null,
  total       integer not null,
  started_by  text not null,
  started_at  timestamptz not null
);
create table org_guide_recipients (
  send_id     bigint not null references org_guide_sends(id) on delete cascade,
  email       text not null,
  body        text not null,
  sent_at     timestamptz,
  error       text,
  primary key (send_id, email)
);
alter table org_guide_sends enable row level security;
alter table org_guide_recipients enable row level security;
revoke all on org_guide_sends from anon, authenticated;
revoke all on org_guide_recipients from anon, authenticated;
