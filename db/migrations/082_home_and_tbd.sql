-- Scenic City Scheduler (SPEC.md section 13, step 7): each matchup has a home team, and a team with no opponent plays
-- TBD (team_b empty).
-- home_side: 'a' (team_a is home) or 'b' (team_b is home; for a TBD game, the team is away). Matchups made before this
-- have none and count team_a as home.
alter table scenic_matchups
  alter column team_b drop not null,
  add column home_side text check (home_side in ('a', 'b'));
-- A team plays TBD at most once a day in a League.
create unique index scenic_matchups_tbd on scenic_matchups (program_id, day, team_a) where team_b is null;
