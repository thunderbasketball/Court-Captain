-- One card payment for several teams (SPEC.md section 14, Payments): the public Register form (an organization's new
-- teams) and Register ALL pay once for all their teams. Each team in the payment, what it picked and what it costs; the
-- teams are registered together once Stripe says it's paid. A payment's own team columns stay for one-team payments.
create table registration_payment_teams (
  payment_id  bigint not null references registration_payments(id) on delete cascade,
  team_id     bigint not null references scenic_teams(id) on delete cascade,
  org_team_id bigint,                    -- its team page in its organization
  choice      jsonb,                     -- a League's options and dates (null: a Circuit or Tournament)
  fee_cents   integer not null check (fee_cents >= 0),
  primary key (payment_id, team_id)
);
alter table registration_payment_teams enable row level security;
revoke all on registration_payment_teams from anon, authenticated;

-- A payment for several teams has no single team.
alter table registration_payments alter column team_id drop not null;
