-- REC open to (SPEC.md section 13): a program can limit REC to the organizations a Director of Programs picks.
-- rec_limited_by null = REC open to everyone. Stand-alone (CourtSolo) teams can't be picked. COMP stays open to all.
alter table scenic_programs
  add column rec_limited_by text,
  add column rec_limited_at timestamptz;

create table scenic_program_rec_partners (
  program_id  bigint not null references scenic_programs(id) on delete cascade,
  partner_id  bigint not null references partners(id) on delete cascade,
  added_by    text not null,
  added_at    timestamptz not null default now(),
  primary key (program_id, partner_id)
);
alter table scenic_program_rec_partners enable row level security;
revoke all on scenic_program_rec_partners from anon, authenticated;
