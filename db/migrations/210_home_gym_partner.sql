-- A partner that plays its home games at another partner's gyms (East Hamilton Youth Association at East Hamilton High
-- School): its teams' home games go to that partner's gyms on the Scheduler and count as home there. Who set it and when.
set local lock_timeout = '5s';
alter table partners
  add column home_partner_id bigint references partners(id) on delete set null check (home_partner_id <> id),
  add column home_partner_by text,
  add column home_partner_at timestamptz;
update partners set home_partner_id = h.id, home_partner_by = 'Earl Epps', home_partner_at = now()
  from partners h
 where partners.org_slug = 'east-hamilton-youth-association' and h.org_slug = 'east-hamilton-high-school';
