-- Officials on games (SPEC.md section 14, step 4c-4): an Officials Group's Assigners drag its officials into each game's
-- 2 referee spots. A scrimmage now; League games later (another column). Never a Recruit; never two games at once.
create table game_officials (
  id            bigint generated always as identity primary key,
  scrimmage_id  bigint not null references scrimmages(id) on delete cascade,
  position      smallint not null check (position in (1, 2)),
  officials_org text not null references organizations(slug) on update cascade on delete cascade,
  coach_id      text not null references users(coach_id) on delete cascade,
  assigned_by   text not null,
  assigned_at   timestamptz not null default now(),
  unique (scrimmage_id, position),
  unique (scrimmage_id, coach_id)
);
create index game_officials_coach on game_officials (coach_id);
alter table game_officials enable row level security;
revoke all on game_officials from anon, authenticated;
