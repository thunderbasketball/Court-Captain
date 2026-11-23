-- Again as in 174: teams registered on the live site before its code caught up got the Abbreviation first
-- ("EHYA 8B EHYA James" → "8B EHYA James"). Only names change. (No organization has a Default Alternate name yet.)
update scenic_teams st set name = ot.name
  from org_teams ot join organizations o on o.slug = ot.org
 where st.org_team_id = ot.id and st.name <> ot.name and o.default_alt_name is null;
