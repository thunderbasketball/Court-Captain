-- Players added in the app (SPEC.md section 14): a side registration next to TeamSnap's, shown everywhere TeamSnap's
-- players are. Owners, Admins and Directors of Players add them and may waive their fees. The sheet sync replaces only
-- TeamSnap's players; a rule here keeps added players from being deleted by any bulk delete (the sync included), so
-- removing one is deliberate (it sets app.remove_added_player for that transaction).
alter table registrations
  add column added_by text,          -- who added the player in the app (null: from TeamSnap)
  add column added_at timestamptz,
  add column fees_waived_by text,    -- who waived the fees, and when
  add column fees_waived_at timestamptz;

create sequence added_player_seq;

create function keep_added_players() returns trigger language plpgsql as $$
begin
  if old.added_by is not null and coalesce(current_setting('app.remove_added_player', true), '') <> 'on' then
    return null; -- skip: added players are only removed on purpose
  end if;
  return old;
end $$;

create trigger keep_added_players before delete on registrations for each row execute function keep_added_players();
