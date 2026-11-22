-- Paying to register (SPEC.md section 14, Payments step 3). Each organization picks who pays Stripe's card fee: the
-- organization (out of what it receives) or the team (added as "Card processing"). Who set it is recorded.
alter table org_stripe
  add column fee_payer text not null default 'org' check (fee_payer in ('org', 'team')),
  add column fee_payer_by text,
  add column fee_payer_at timestamptz;

-- A team's registration waiting on its card payment: what it picked (registered only once Stripe says it's paid), what
-- it costs, and the Stripe Checkout it's paying through (on the receiving organization's own Stripe account).
create table registration_payments (
  id             bigserial primary key,
  org            text not null references organizations(slug) on update cascade on delete cascade, -- who gets paid
  livemode       boolean not null,
  account_id     text not null check (account_id ~ '^acct_[A-Za-z0-9]+$'),
  program_id     bigint not null references scenic_programs(id) on delete cascade,
  team_id        bigint not null references scenic_teams(id) on delete cascade,
  team_org       text references organizations(slug) on update cascade on delete set null, -- the team's organization
  org_team_id    bigint,                    -- its team page there
  choice         jsonb,                     -- a League's options and dates (null: a Circuit or Tournament)
  fee_cents      integer not null check (fee_cents > 0),
  card_fee_cents integer not null default 0 check (card_fee_cents >= 0), -- added for the team
  session_id     text unique check (session_id ~ '^cs_[A-Za-z0-9_]+$'),
  status         text not null default 'started' check (status in ('started', 'registered', 'failed')),
  error          text,                      -- paid, but registering didn't go through (Owners see it; refund it)
  started_by     text not null,
  started_at     timestamptz not null default now(),
  registered_at  timestamptz
);
create index registration_payments_team on registration_payments (program_id, team_id);
alter table registration_payments enable row level security;
revoke all on registration_payments from anon, authenticated;
revoke all on sequence registration_payments_id_seq from anon, authenticated;
