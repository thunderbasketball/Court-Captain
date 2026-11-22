-- Team Uniforms tab: Needs a uniform for a player already on a vendor order (outgrown, lost): they go in the next order.
-- Who ticked it recorded. (Later: this emails the parent a link for the size and payment.)
alter table team_uniforms add column reorder_by text, add column reorder_at timestamptz;
