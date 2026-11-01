-- Scenic City Leagues (SPEC.md section 13): each program date is a Game Day (regular season) or a Bracket Day (the
-- post-season brackets at the end). Both are Scenic City game days where hosting sites give court hours.
alter table program_game_days add column kind text not null default 'game' check (kind in ('game', 'bracket'));
