-- A card payment's Stripe reference (SPEC.md section 14, Payments), for matching it in Stripe: its payment id, and the card
-- as Stripe shows it ("Visa ending 4242", never the number). Asked from Stripe once, when the League's Owners look at it.
alter table registration_payments
  add column stripe_payment text check (stripe_payment ~ '^pi_[A-Za-z0-9_]+$'),
  add column stripe_card text check (length(stripe_card) <= 60);
