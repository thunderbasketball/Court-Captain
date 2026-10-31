-- CourtCaptain Admins (SPEC.md section 14): run the platform (organizations, their features, their Directors).
-- Not tied to any organization. Given with `npm run user -- admin <cell>`.

create table platform_admins (
  coach_id    text primary key references users(coach_id) on delete cascade,
  granted_by  text not null,
  granted_at  timestamptz not null default now()
);

alter table platform_admins enable row level security;
revoke all on platform_admins from anon, authenticated;
