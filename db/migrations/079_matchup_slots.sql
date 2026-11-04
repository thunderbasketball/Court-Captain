-- Scenic City Scheduler Grid (SPEC.md section 13, step 7): a matchup placed in a game slot, a court at a start time
-- (Eastern) on its Game Day. court_key: a partner's court id ("123"), or an organization's gym court ("o39-12", or
-- "o39-gym" for a whole gym). One game per court and start time per day; who placed it is recorded.
alter table scenic_matchups
  add column court_key text,
  add column starts time,
  add column placed_by text,
  add column placed_at timestamptz,
  add constraint scenic_matchups_slot check ((court_key is null) = (starts is null));
create unique index scenic_matchups_slot_taken on scenic_matchups (day, court_key, starts) where court_key is not null;
