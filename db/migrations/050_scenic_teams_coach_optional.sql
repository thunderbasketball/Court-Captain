-- An organization's team can be registered in Scenic City before it has a Head Coach (added later in the organization,
-- and copied over then). Scenic City's own teams still name a coach (checked in lib/scenic-teams).
alter table scenic_teams alter column coach_id drop not null;
