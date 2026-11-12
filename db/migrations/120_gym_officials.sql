-- Which officials group schedules officials at each of a league's hosting gyms (SPEC.md section 14, step 4c). gym_key:
-- 'o<gyms.id>' (a hosting organization's gym) or 'p<partner_gyms.id>' (a gym the league typed in). The group must be
-- approved to officiate the league's games (officiating_partnerships).
create table gym_officials (
  org            text not null references organizations(slug) on update cascade on delete cascade,
  gym_key        text not null check (gym_key ~ '^[op][0-9]+$'),
  officials_org  text not null references organizations(slug) on update cascade on delete cascade,
  set_by         text not null,
  set_at         timestamptz not null default now(),
  primary key (org, gym_key)
);
alter table gym_officials enable row level security;
revoke all on gym_officials from anon, authenticated;
