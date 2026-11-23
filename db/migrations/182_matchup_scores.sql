-- A League game's final score (SPEC.md section 13): team_a's and team_b's points, who entered it and when. Season
-- records (wins and losses) come from scored games; the public page's Standings and Games of the Week use them.
alter table scenic_matchups
  add column score_a  smallint check (score_a between 0 and 250),
  add column score_b  smallint check (score_b between 0 and 250),
  add column scored_by text,
  add column scored_at timestamptz,
  add constraint scenic_matchups_score_both check ((score_a is null) = (score_b is null));
