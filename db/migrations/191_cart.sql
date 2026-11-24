-- Shopping cart (SPEC.md section 14, Payments): what a person picked to register (a team into a program, or dates added to
-- a registration), kept until they pay, take it out, or someone else registers it. Each person's own. The team: an
-- organization's own team (org_team_id), or a League team (team_id: Thunder's copy, Solo, a club). Nothing is registered,
-- held or priced here: rules, rights and prices are checked when it's shown and again when it's paid.
create table cart_items (
  id          bigserial primary key,
  coach_id    text not null references users(coach_id) on delete cascade,
  program_id  bigint not null references scenic_programs(id) on delete cascade,
  team_org    text not null references organizations(slug) on update cascade on delete cascade, -- whose team it is
  org_team_id bigint references org_teams(id) on delete cascade,
  team_id     bigint references scenic_teams(id) on delete cascade,
  choice      jsonb,                              -- a League's options and dates (null: a Circuit or Tournament)
  adding      boolean not null default false,     -- the team was already registered (dates or a 2nd Game)
  added_at    timestamptz not null,
  removed_at  timestamptz,                        -- came out by itself…
  removed_why text,                               -- …and why (shown to them for a week, or until dismissed)
  check ((org_team_id is null) <> (team_id is null)),
  check ((removed_at is null) = (removed_why is null))
);
create unique index cart_items_org_team on cart_items (coach_id, program_id, org_team_id) where org_team_id is not null and removed_at is null;
create unique index cart_items_team on cart_items (coach_id, program_id, team_id) where team_id is not null and removed_at is null;
create index cart_items_coach on cart_items (coach_id);
alter table cart_items enable row level security;
revoke all on cart_items from anon, authenticated;
revoke all on sequence cart_items_id_seq from anon, authenticated;

-- A payment made from a cart: its items, which leave the cart when it goes through.
alter table registration_payments add column cart_items bigint[];
