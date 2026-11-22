-- Payments (SPEC.md section 14): an organization's own Stripe account (Standard, through CourtCaptain's Stripe Connect
-- platform). Teams pay it directly; CourtCaptain never holds the money. One account per organization per mode (test
-- keys while building, live keys later). Who connected it is recorded.
create table org_stripe (
  org               text not null references organizations(slug) on update cascade on delete cascade,
  livemode          boolean not null,
  account_id        text not null unique check (account_id ~ '^acct_[A-Za-z0-9]+$'),
  charges_enabled   boolean not null default false,  -- Stripe says it can take payments
  details_submitted boolean not null default false,  -- its owner finished Stripe's sign-up
  connected_by      text not null,
  connected_at      timestamptz not null default now(),
  checked_at        timestamptz,
  primary key (org, livemode)
);
alter table org_stripe enable row level security;
revoke all on org_stripe from anon, authenticated;
