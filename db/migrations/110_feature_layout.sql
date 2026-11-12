-- The feature layout (SPEC.md section 14, "Where we're going", step 4a). Additive: the old rows stay for the live site
-- until it runs this code, then get deleted (RETIRED_KEYS in lib/features.ts).
--   CourtScheduler → part of CourtTeams; its CourtSync Scheduler part is now CourtSync itself.
--   CourtFacility  → CourtFacilities (free, every organization) + CourtPractice (paid; comes with CourtPlayers).
--   CourtClub, CourtFacilities and Alerts come with every organization (not stored).
insert into org_features (org, feature, source, turned_on_by, turned_on_at)
select org, n.feature, min(source), 'setup', min(turned_on_at)
from org_features f
cross join lateral (values
  ('court-teams', f.feature = 'court-scheduler'),
  ('court-sync', f.feature = 'court-scheduler'),
  ('court-practice', f.feature = 'court-facility'
     and not exists (select 1 from org_features p where p.org = f.org and p.feature = 'court-players'))
) as n(feature, yes)
where n.yes
group by org, n.feature
on conflict (org, feature) do nothing;

insert into org_feature_requests (org, feature, asked_by, asked_at)
select org, n.feature, min(asked_by), min(asked_at)
from org_feature_requests f
cross join lateral (values
  ('court-teams', f.feature = 'court-scheduler'),
  ('court-practice', f.feature = 'court-facility')
) as n(feature, yes)
where n.yes
group by org, n.feature
on conflict do nothing;

-- CourtSync is free: an organization's Owners and Admins turn it on themselves (source 'org').
alter table org_features drop constraint if exists org_features_source_check;
alter table org_features add constraint org_features_source_check check (source in ('setup', 'purchase', 'comp', 'org'));
