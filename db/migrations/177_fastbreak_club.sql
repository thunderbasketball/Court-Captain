-- FastBreak is treated like an organization in Scenic City (SPEC.md section 14): teams brought in from FastBreak belong
-- to an outside club named "FastBreak" (tag FB), not to their coach as Solo teams. Teams already added move there; their
-- Head Coach stays, and registrations, games and payments stay as they are.
insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, abbr)
select 'FastBreak', 'Organization', false, true, true, 'FastBreak', 'FB'
 where not exists (select 1 from partners where lower(name) = 'fastbreak');

update scenic_teams
   set partner_id = (select id from partners where lower(name) = 'fastbreak' order by id limit 1), owner_coach_id = null
 where fastbreak_id is not null and partner_id is null;
