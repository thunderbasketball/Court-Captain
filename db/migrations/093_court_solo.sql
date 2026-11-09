-- CourtSolo (SPEC.md section 14): a stand-alone team is its own small CourtCaptain account, an organization of kind
-- 'Team' with one team (its name is the team's name) and the court-solo feature. Its copy in a league shows "(Solo)".
alter table organizations drop constraint if exists organizations_kind_check;
alter table organizations add constraint organizations_kind_check check (kind in ('Organization', 'School', 'Club', 'League', 'Team'));
