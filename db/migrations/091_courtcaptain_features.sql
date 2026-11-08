-- CourtCaptain features get their names (SPEC.md section 14): CourtPlayers, CourtTeams, CourtOrg, CourtScheduler,
-- CourtSync, CourtFacility. Additive: the old rows stay for the live site until it runs the new code, then get deleted.
insert into org_features (org, feature, source, turned_on_by, turned_on_at)
select org, n.feature, min(source), 'setup', min(turned_on_at)
from org_features f
cross join lateral (values
  ('court-players', f.feature in ('player-registration', 'uniforms', 'events')),
  ('court-teams', f.feature = 'team-registration'),
  ('court-org', f.feature = 'team-building'
     and not exists (select 1 from org_features p where p.org = f.org and p.feature = 'player-registration')),
  ('court-scheduler', f.feature in ('programs', 'officials', 'hosting-partners')),
  ('court-sync', f.feature = 'hosting-available'),
  ('court-facility', f.feature = 'practice')
) as n(feature, yes)
where n.yes
group by org, n.feature
on conflict (org, feature) do nothing;

-- Requested features (new organizations) the same way.
insert into org_feature_requests (org, feature, asked_by, asked_at)
select org, n.feature, min(asked_by), min(asked_at)
from org_feature_requests f
cross join lateral (values
  ('court-players', f.feature in ('player-registration', 'uniforms', 'events')),
  ('court-teams', f.feature = 'team-registration'),
  ('court-org', f.feature = 'team-building'),
  ('court-scheduler', f.feature in ('programs', 'officials', 'hosting-partners')),
  ('court-sync', f.feature = 'hosting-available'),
  ('court-facility', f.feature = 'practice')
) as n(feature, yes)
where n.yes
group by org, n.feature
on conflict (org, feature) do nothing;
