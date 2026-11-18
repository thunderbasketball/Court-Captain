-- CourtPlaybook ✨ Draft from description (SPEC.md section 14): each AI draft asked for, who asked and when, so a person
-- gets at most 25 a day (each costs a few cents) and Owners can see the use. The description itself isn't kept.
create table play_drafts (
  id        bigserial primary key,
  org       text not null references organizations(slug) on update cascade on delete cascade,
  coach_id  text not null,
  asked_by  text not null,
  asked_at  timestamptz not null default now(),
  ok        boolean not null
);
create index play_drafts_who on play_drafts (coach_id, asked_at);

alter table play_drafts enable row level security;
revoke all on play_drafts from anon, authenticated;
revoke all on sequence play_drafts_id_seq from anon, authenticated;
