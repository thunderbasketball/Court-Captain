-- A player's parent added or fixed in the app (SPEC.md section 14): CourtPlayers' team staff, Directors, Admins and Owners.
-- The sheet sync replaces registrations, so each is kept here (its place: parent 1 or 2) and put back after every sync.
-- sheet: what the registration says (restored when it's undone). Once the registration says the same, this is dropped.
-- No foreign key: registrations are replaced on each sync.
create table player_parents (
  registrant_id text not null,
  slot          smallint not null check (slot in (1, 2)),
  first_name    text not null,
  last_name     text not null,
  cell          text not null,
  email         text,
  sheet         jsonb not null,
  set_by        text not null,
  set_by_id     text not null,
  set_at        timestamptz not null,
  primary key (registrant_id, slot)
);
alter table player_parents enable row level security;
revoke all on player_parents from anon, authenticated;
