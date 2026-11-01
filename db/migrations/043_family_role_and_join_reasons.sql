-- Sign-up purpose (SPEC.md section 15). A new Thunder account says why they're joining:
--   New family  → the Family role at once (no approval).
--   Team staff  → a request, with the role and the team (or a team typed in, when it isn't listed).
--   Other       → a request, with notes.
alter table org_role_types drop constraint org_role_types_role_check;
alter table org_role_types add constraint org_role_types_role_check
  check (role in ('Request', 'Coach', 'Director', 'Partner', 'Solo', 'Admin', 'Owner', 'Family'));
insert into org_role_types (org, role) values ('thunder', 'Family');

create table join_reasons (
  coach_id    text primary key references users(coach_id) on delete cascade,
  purpose     text not null check (purpose in ('staff', 'other')),
  staff_role  text check (staff_role in ('HeadCoach', 'AsstCoach', 'Manager', 'TeamParent')),
  team_id     bigint references teams(id) on delete set null,
  team_text   text check (char_length(team_text) <= 60),
  notes       text check (char_length(notes) <= 300),
  created_at  timestamptz not null default now(),
  check (purpose <> 'staff' or staff_role is not null)
);
alter table join_reasons enable row level security;
revoke all on join_reasons from anon, authenticated;
