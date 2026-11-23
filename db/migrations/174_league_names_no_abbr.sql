-- An organization's team is named the same in leagues as in its organization (SPEC.md section 14): its REC teams no
-- longer get the organization's Abbreviation first ("FOR 5B Ft. O REC Pickett" → "5B Ft. O REC Pickett"). Only names
-- change; registrations, games and payments stay. Thunder's copies keep "TB" first (Thunder's names don't say Thunder).
update scenic_teams st set name = ot.name
  from org_teams ot
 where st.org_team_id = ot.id and st.name <> ot.name;
