-- Unused: posting by itself was dropped before it shipped (people share pictures instead); to be dropped in a later migration.
-- Final scores posted to social media (SPEC.md section 13; lib/social.ts). Each organization with Leagues turns it on (who,
-- and when: only scores entered after that post). One row a game and network: a game posts once, whatever happens.
create table social_settings (
  org     text primary key references organizations(slug) on delete cascade on update cascade,
  is_on   boolean not null default false,
  on_since timestamptz,
  set_by  text not null,
  set_at  timestamptz not null
);
alter table social_settings enable row level security;
revoke all on social_settings from anon, authenticated;

create table social_posts (
  matchup_id bigint not null references scenic_matchups(id) on delete cascade,
  network    text not null check (network in ('x')),
  status     text not null check (status in ('sending', 'posted', 'failed', 'unsure', 'skipped')),
  body       text,           -- what was sent
  score      text,           -- the score it said, to notice a later correction
  claimed_at timestamptz,
  retry_at   timestamptz,    -- failed: tried again after this (null: only by hand)
  error      text,
  post_id    text check (post_id ~ '^[0-9]{1,25}$'),
  posted_at  timestamptz,
  decided_by text,           -- who chose Don't post or Try again
  primary key (matchup_id, network)
);
alter table social_posts enable row level security;
revoke all on social_posts from anon, authenticated;
