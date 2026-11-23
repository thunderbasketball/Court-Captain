-- Scores and the Power Index (SPEC.md section 13).
-- Director of Scores: an organization's Director who enters the scores of the League games played at its gyms.
alter table director_areas drop constraint director_areas_area_check;
alter table director_areas add constraint director_areas_area_check
  check (area in ('players', 'teams', 'facilities', 'programs', 'officials', 'scheduling',
                  'uniforms', 'practices', 'events', 'support', 'scores'));

-- A forfeit: the side that forfeited ('a' or 'b'); no score then. Who entered it: scored_by / scored_at.
alter table scenic_matchups
  add column forfeit text check (forfeit in ('a', 'b')),
  add constraint scenic_matchups_forfeit_no_score check (forfeit is null or score_a is null);

-- Each program's PI settings (its gear): points per grade of difference, REC vs COMP, the margin cap and the Brackets'
-- weight. Defaults until changed; who changed them is recorded.
alter table scenic_programs
  add column pi_grade_points smallint not null default 50 check (pi_grade_points between 0 and 300),
  add column pi_level_points smallint not null default 100 check (pi_level_points between 0 and 400),
  add column pi_margin_cap smallint not null default 15 check (pi_margin_cap between 1 and 60),
  add column pi_bracket_weight numeric(3, 2) not null default 1.25 check (pi_bracket_weight between 1 and 3),
  add column pi_set_by text,
  add column pi_set_at timestamptz;

-- A program's Power Index for each team (0–1000), worked out again from all its scores whenever one is entered.
create table scenic_pi (
  program_id  bigint not null references scenic_programs(id) on delete cascade,
  team_id     bigint not null references scenic_teams(id) on delete cascade,
  pi          smallint not null check (pi between 0 and 1000),
  wins        smallint not null default 0,
  losses      smallint not null default 0,
  games       smallint not null default 0,
  updated_at  timestamptz not null,
  primary key (program_id, team_id)
);
alter table scenic_pi enable row level security;
revoke all on scenic_pi from anon, authenticated;
