-- The TeamSnap sync re-inserts every row; the trigger gave each one Thunder's newest program (by season), so creating
-- Spring 2027 moved Winter's TeamSnap players into it. A row without a program now gets the latest Thunder program whose
-- registration has opened (else the newest one), and the sync keeps each player's program (lib/teamsnap/import.ts).
create or replace function registrations_program() returns trigger language plpgsql as $$
begin
  if new.program_id is null then
    new.program_id := coalesce(
      (select id from player_programs where org = 'thunder' and reg_opens <= current_date
        order by reg_opens desc, id desc limit 1),
      (select id from player_programs where org = 'thunder' order by coalesce(starts_on, reg_opens) desc, id desc limit 1));
  end if;
  return new;
end $$;
revoke all on function registrations_program() from public, anon, authenticated;

-- Put TeamSnap's players back in the program open for registration (Winter 26/27), out of one not yet open.
update registrations r set program_id = (
    select id from player_programs where org = 'thunder' and reg_opens <= current_date order by reg_opens desc, id desc limit 1)
 where r.added_by is null
   and exists (select 1 from player_programs p where p.id = r.program_id and p.reg_opens > current_date)
   and exists (select 1 from player_programs where org = 'thunder' and reg_opens <= current_date);
