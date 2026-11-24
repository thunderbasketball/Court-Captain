-- An invoice requested from a cart (SPEC.md section 14, Payments): one organization's teams in one program, to be paid later
-- (by card from its page, or marked paid by the League's Owners). Nothing is registered until it's paid. Its items leave the
-- cart (cart_items.invoice_id) and come back if it's cancelled; not paid by its due date, they come out.
create table cart_invoices (
  id             bigserial primary key,
  program_id     bigint not null references scenic_programs(id) on delete cascade,
  team_org       text not null references organizations(slug) on update cascade on delete cascade,
  coach_id       text not null references users(coach_id) on delete cascade, -- who requested it (whose cart)
  requested_name text not null,
  requested_at   timestamptz not null,
  due_on         date not null,
  paid_by        text,
  paid_at        timestamptz,
  cancelled_by   text,
  cancelled_at   timestamptz,
  check ((paid_at is null) = (paid_by is null)),
  check ((cancelled_at is null) = (cancelled_by is null)),
  check (paid_at is null or cancelled_at is null)
);
create index cart_invoices_program on cart_invoices (program_id);
alter table cart_invoices enable row level security;
revoke all on cart_invoices from anon, authenticated;
revoke all on sequence cart_invoices_id_seq from anon, authenticated;

alter table cart_items add column invoice_id bigint references cart_invoices(id) on delete cascade;
create index cart_items_invoice on cart_items (invoice_id) where invoice_id is not null;
-- One item per team and program in the cart itself (an invoice's are apart: a 2nd Game may go in the cart meanwhile).
drop index cart_items_org_team;
drop index cart_items_team;
create unique index cart_items_org_team on cart_items (coach_id, program_id, org_team_id)
  where org_team_id is not null and removed_at is null and invoice_id is null;
create unique index cart_items_team on cart_items (coach_id, program_id, team_id)
  where team_id is not null and removed_at is null and invoice_id is null;

-- A payment of a requested invoice.
alter table registration_payments add column cart_invoice_id bigint references cart_invoices(id) on delete set null;
