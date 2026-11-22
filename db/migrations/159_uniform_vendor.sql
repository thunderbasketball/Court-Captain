-- Uniform vendor (Uniforms card): the vendor's email and who's copied, set in the card's gear (Directors of Uniforms),
-- and each emailed uniform order with the players it sent, so the next send has only the new ones. Who did it recorded.
create table uniform_vendor (
  org       text primary key references organizations(slug) on update cascade on delete cascade,
  email     text check (email is null or length(email) <= 254),
  cc        text[] not null default '{}' check (cardinality(cc) <= 10),
  set_by    text not null,
  set_at    timestamptz not null default now()
);
create table uniform_vendor_sends (
  id        bigserial primary key,
  org       text not null references organizations(slug) on update cascade on delete cascade,
  order_no  text not null check (order_no ~ '^[0-9]{8}(-[0-9]{1,3})?$'), -- the date it was sent, 20261120 (a second that day: 20261120-2)
  sent_to   text not null,
  cc        text[] not null default '{}',
  players   int not null check (players > 0),
  everyone  boolean not null, -- Send everyone (the full list), else only the new ones
  sent_by   text not null,
  sent_at   timestamptz not null default now()
);
create index uniform_vendor_sends_org on uniform_vendor_sends (org, sent_at desc);
create unique index uniform_vendor_sends_order on uniform_vendor_sends (org, order_no);
-- Each order's players as sent (Past orders on the card keeps them even after a player or team changes); a player (on a
-- team) in any order is left out of the next "new" send.
create table uniform_vendor_sent (
  send_id       bigint not null references uniform_vendor_sends(id) on delete cascade,
  team_id       bigint not null,  -- no reference: the order stays as sent if the team is deleted
  registrant_id text not null,
  team          text not null,
  gender        text not null,
  name          text not null,    -- jersey name, as sent
  number        text not null,
  size          text not null,
  primary key (send_id, team_id, registrant_id)
);
create index uniform_vendor_sent_player on uniform_vendor_sent (team_id, registrant_id);
alter table uniform_vendor enable row level security;
alter table uniform_vendor_sends enable row level security;
alter table uniform_vendor_sent enable row level security;
revoke all on uniform_vendor, uniform_vendor_sends, uniform_vendor_sent from anon, authenticated;
revoke all on sequence uniform_vendor_sends_id_seq from anon, authenticated;
