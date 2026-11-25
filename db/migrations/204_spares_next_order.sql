-- Spares go with the next order to the vendor: added here with no order yet (send_id null), and joined to the order that takes
-- them. An order can be spares alone (no players).
set local lock_timeout = '5s';
alter table uniform_vendor_spares alter column send_id drop not null;
alter table uniform_vendor_spares add column added_by text;
alter table uniform_vendor_spares add column added_at timestamptz;
alter table uniform_vendor_sends drop constraint uniform_vendor_sends_players_check;
alter table uniform_vendor_sends add constraint uniform_vendor_sends_players_check check (players >= 0);
