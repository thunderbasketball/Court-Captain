-- Refunds (SPEC.md section 14, Payments): the League's Owners refund a card payment, any amount up to what's left (more
-- than once). Who refunded, how much and Stripe's refund are recorded. A payment's record stays when its team is deleted
-- (its name kept), so it can still be refunded.
create table registration_refunds (
  id          bigserial primary key,
  payment_id  bigint not null references registration_payments(id) on delete cascade,
  cents       integer not null check (cents > 0),
  refund_id   text not null unique check (refund_id ~ '^re_[A-Za-z0-9_]+$'), -- Stripe's refund
  refunded_by text not null,
  refunded_at timestamptz not null
);
create index registration_refunds_payment on registration_refunds (payment_id);
alter table registration_refunds enable row level security;
revoke all on registration_refunds from anon, authenticated;
revoke all on sequence registration_refunds_id_seq from anon, authenticated;

-- Each team in a payment keeps its name; deleting the team leaves the payment.
alter table registration_payment_teams add column team_name text;
update registration_payment_teams x set team_name = t.name from scenic_teams t where t.id = x.team_id;
alter table registration_payment_teams drop constraint registration_payment_teams_pkey;
alter table registration_payment_teams add column id bigserial primary key;
alter table registration_payment_teams alter column team_id drop not null;
alter table registration_payment_teams drop constraint registration_payment_teams_team_id_fkey;
alter table registration_payment_teams
  add constraint registration_payment_teams_team_id_fkey foreign key (team_id) references scenic_teams(id) on delete set null;
create unique index registration_payment_teams_team on registration_payment_teams (payment_id, team_id) where team_id is not null;
revoke all on sequence registration_payment_teams_id_seq from anon, authenticated;

alter table registration_payments drop constraint registration_payments_team_id_fkey;
alter table registration_payments
  add constraint registration_payments_team_id_fkey foreign key (team_id) references scenic_teams(id) on delete set null;
