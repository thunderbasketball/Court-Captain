-- Thunder's teams are named in leagues like every organization's (SPEC.md section 14): grade and gender, the team's
-- Alternate name (else Thunder's short name), the rest of its name ("TB 5B Johnson" → "5B Thunder Johnson"). Only
-- names change.
update scenic_teams st
   set name = regexp_replace(t.name, '^(\S+)\s+', '\1 ' || coalesce(nullif(trim(t.alt_name), ''),
                (select short_name from organizations where slug = 'thunder'), 'Thunder') || ' ')
  from teams t
 where st.thunder_team_id = t.id;
