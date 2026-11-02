-- Team names (SPEC.md section 14): every team is named Grade + Gender + its Head Coach's last name ("4G Epps"; "4G TBD"
-- until it has one), unique within its organization, with an optional Alternate name ("Bolts"). In a league it shows
-- with its organization's Abbreviation first ("ER 5B Harris").
alter table organizations add column abbr text check (abbr ~ '^[A-Za-z0-9]{1,6}$');
update organizations set abbr = case slug when 'thunder' then 'TB' when 'scenic-city' then 'SC' else
  upper(left(regexp_replace(initcap(coalesce(short_name, name)), '[^A-Z0-9]', '', 'g'), 6)) end;
update organizations set abbr = upper(left(regexp_replace(slug, '[^a-z0-9]', '', 'g'), 6)) where abbr is null or abbr = '';

alter table org_teams add column alt_name text;
alter table teams add column alt_name text;

-- Existing organization teams follow the rule now; a name that doesn't is kept as the Alternate name.
with named as (
  select t.id, t.name as old,
         (case when t.grade = 0 then 'K' else t.grade::text end) || left(t.gender, 1) || ' ' || coalesce(u.last_name, 'TBD') as base
  from org_teams t
  left join org_team_coaches c on c.team_id = t.id and c.role = 'HeadCoach'
  left join users u on u.coach_id = c.coach_id
), numbered as (
  select id, old, base || case when row_number() over (partition by (select org from org_teams o where o.id = named.id), lower(base) order by id) > 1
                             then ' ' || row_number() over (partition by (select org from org_teams o where o.id = named.id), lower(base) order by id)
                             else '' end as name
  from named
)
update org_teams t set name = n.name, alt_name = case when lower(n.old) <> lower(n.name) then n.old end
from numbered n where n.id = t.id;
