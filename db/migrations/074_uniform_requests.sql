-- A team's coaches can mark that a player who didn't order a uniform at registration does need one (SPEC.md section 3,
-- Uniforms). The player then needs a size, and is listed on Home for the Director of Uniforms to add to the TeamSnap
-- order; marking it added (or the sheet showing the order) takes them off that list.
alter table team_uniforms
  add column needs_uniform_by text,
  add column needs_uniform_at timestamptz,
  add column order_added_by text,
  add column order_added_at timestamptz;
