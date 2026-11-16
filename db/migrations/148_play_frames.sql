-- CourtPlaybook: each play drawn on a half court, in frames (players, the ball, and cuts, passes, dribbles and
-- screens; checked in lib/play-diagram.ts). '[]' = not drawn yet.
alter table plays add column frames jsonb not null default '[]'::jsonb;
