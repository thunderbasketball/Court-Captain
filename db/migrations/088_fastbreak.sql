-- FastBreak Compete: teams registered there are added to Scenic City's League (outside clubs only; SPEC section 13).

-- The Fastbreak team a Scenic City team came from (none: added in the app).
alter table scenic_teams add column fastbreak_id bigint unique;

-- Each organization seen in Fastbreak and what it is here: an outside club (partner_id), on CourtCaptain (skip: its
-- teams are left alone; it registers its own), or neither yet (waiting for a Director to pick).
create table fastbreak_orgs (
  fb_org_id   bigint primary key,
  fb_name     text not null,
  partner_id  bigint references partners(id) on delete set null,
  skip        boolean not null default false,
  set_by      text,
  set_at      timestamptz,
  first_seen  timestamptz not null default now(),
  check (not (skip and partner_id is not null))
);

alter table fastbreak_orgs enable row level security;
revoke all on fastbreak_orgs from anon, authenticated;
