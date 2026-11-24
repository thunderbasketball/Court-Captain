-- Pay later for one registration (SPEC.md section 14, Payments): a League Owner registered it from someone's cart, to be
-- paid later (due in 30 days), though its organization isn't in a Pay later price group. Who and when.
alter table scenic_registrations add column pay_later_by text, add column pay_later_at timestamptz;
-- Paid before more was added to pay later: what was paid, so only the rest is owed (null: nothing, or all of it when paid).
alter table scenic_registrations add column paid_cents integer check (paid_cents >= 0);
