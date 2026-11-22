-- Paying an open invoice (SPEC.md section 14, Payments): a card payment for teams already registered (Pay later), marked
-- Paid when Stripe says it's paid, as against paying to register (the teams registered once it's paid).
alter table registration_payments
  add column kind text not null default 'register' check (kind in ('register', 'invoice'));
