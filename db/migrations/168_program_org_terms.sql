-- An organization's own terms in a League (SPEC.md section 14, Payments): its ALL Season price per team (null: the
-- League's) and Pay later (its teams register without paying by card; Scenic City's Owners mark them Paid). Set in the
-- program's Fees; who set it is recorded.
create table scenic_program_org_terms (
  program_id       bigint not null references scenic_programs(id) on delete cascade,
  org              text not null references organizations(slug) on update cascade on delete cascade,
  all_season_cents integer check (all_season_cents >= 0),
  pay_later        boolean not null default false,
  set_by           text not null,
  set_at           timestamptz not null,
  primary key (program_id, org)
);
alter table scenic_program_org_terms enable row level security;
revoke all on scenic_program_org_terms from anon, authenticated;
