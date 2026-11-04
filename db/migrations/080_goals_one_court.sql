-- Scheduler Grid: practice goals ("Goal #1", "Goal #2") are halves of one court, so a gym's goals are one game court
-- (its whole gym). Games placed on a goal move to the whole gym; if two were at the same time, the second comes off
-- the grid to be placed again.
with goal_games as (
  select m.id, m.day, m.starts, 'o' || g.id || '-gym' as whole,
         row_number() over (partition by m.day, g.id, m.starts order by m.placed_at nulls last, m.id) as n
    from scenic_matchups m
    join courts c on m.court_key = 'o' || c.gym_id || '-' || c.id and c.name ~* '^goal'
    join gyms g on g.id = c.gym_id
)
update scenic_matchups m
   set court_key = case when x.n = 1 then x.whole end,
       starts = case when x.n = 1 then m.starts end
  from goal_games x
 where x.id = m.id;
