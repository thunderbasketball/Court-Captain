-- CourtClub (SPEC.md section 14): CourtOrg and CourtSolo become one feature. A stand-alone team is still a club of one
-- (organizations.kind = 'Team'). Additive: the old rows stay for the live site until it runs the new code, then get
-- deleted (RETIRED_KEYS in lib/features.ts).
insert into org_features (org, feature, source, turned_on_by, turned_on_at)
select org, 'court-club', min(source), 'setup', min(turned_on_at)
from org_features where feature in ('court-org', 'court-solo')
group by org
on conflict (org, feature) do nothing;

insert into org_feature_requests (org, feature, asked_by, asked_at)
select org, 'court-club', min(asked_by), min(asked_at)
from org_feature_requests where feature in ('court-org', 'court-solo')
group by org
on conflict do nothing;

-- CourtClub's setting: how many days its teams stay active after an event they're in ends. Null = 30.
alter table organizations add column club_active_days int check (club_active_days between 1 and 365);
