-- Spare uniforms (Uniforms card, Order Spares; lib/uniform-spares.ts): their own vendor orders, in the same numbering and Past
-- orders. A set (jersey and shorts), jersey or shooting shirt has a number and a size; shorts just how many of a size.
alter table uniform_vendor_sends add column kind text not null default 'players' check (kind in ('players', 'spares'));
create table uniform_vendor_spares (
  id      bigserial primary key,
  send_id bigint not null references uniform_vendor_sends(id) on delete cascade,
  item    text not null check (item in ('set', 'jersey', 'shirt', 'shorts')),
  number  text check (number ~ '^\d{1,2}$'),
  size    text not null,
  qty     int not null check (qty between 1 and 200),
  check ((item = 'shorts') = (number is null))
);
create index uniform_vendor_spares_send on uniform_vendor_spares (send_id);
alter table uniform_vendor_spares enable row level security;
revoke all on uniform_vendor_spares from anon, authenticated;
revoke all on sequence uniform_vendor_spares_id_seq from anon, authenticated;
