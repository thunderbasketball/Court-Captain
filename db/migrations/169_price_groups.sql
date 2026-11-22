-- Named price groups in a League (SPEC.md section 14, Payments): each a name (the tag its organizations get), an ALL
-- Season price per team (null: the League's) and Pay later. An organization is in at most one group per program
-- (scenic_program_org_terms.group_id); none: the standard price, paid by card. Who set it is recorded.
create table scenic_price_groups (
  id               bigserial primary key,
  program_id       bigint not null references scenic_programs(id) on delete cascade,
  name             text not null check (length(name) between 1 and 40),
  all_season_cents integer check (all_season_cents >= 0),
  pay_later        boolean not null default false,
  set_by           text not null,
  set_at           timestamptz not null
);
create unique index scenic_price_groups_name on scenic_price_groups (program_id, lower(name));
alter table scenic_price_groups enable row level security;
revoke all on scenic_price_groups from anon, authenticated;
revoke all on sequence scenic_price_groups_id_seq from anon, authenticated;

-- Each organization's terms point at its group (the group holds the price and Pay later).
alter table scenic_program_org_terms add column group_id bigint references scenic_price_groups(id) on delete cascade;
insert into scenic_price_groups (program_id, name, all_season_cents, pay_later, set_by, set_at)
select distinct on (program_id, all_season_cents, pay_later)
       program_id,
       coalesce('$' || to_char(all_season_cents / 100.0, 'FM999999.00'), 'League price') || case when pay_later then ' · Pay later' else '' end,
       all_season_cents, pay_later, set_by, set_at
  from scenic_program_org_terms order by program_id, all_season_cents, pay_later, set_at;
update scenic_program_org_terms t set group_id = g.id from scenic_price_groups g
 where g.program_id = t.program_id and g.all_season_cents is not distinct from t.all_season_cents and g.pay_later = t.pay_later;
alter table scenic_program_org_terms alter column group_id set not null;
