-- Team Uniforms tab: a player's uniform info locks once they have their uniform (sent to the vendor, or a number with no
-- new uniform ordered). A team coach, Admin, Director of Uniforms or Owner can unlock it to change it; who did it recorded.
alter table team_uniforms add column unlocked_by text, add column unlocked_at timestamptz;
