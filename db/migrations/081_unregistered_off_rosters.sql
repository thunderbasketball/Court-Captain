-- Players no longer in registrations come off every roster (SPEC.md section 3); the registrations sync does this from
-- now on. This clears the ones already there. Past check-ins stay.
delete from team_players p where not exists (select 1 from registrations g where g.registrant_id = p.registrant_id);
delete from team_uniforms u where not exists (select 1 from registrations g where g.registrant_id = u.registrant_id);
