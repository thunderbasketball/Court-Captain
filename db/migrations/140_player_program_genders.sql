-- A player program's genders (SPEC.md section 14): Boys, Girls or both. Its Sessions and scrimmages follow them.
alter table player_programs add column genders text[] not null default '{Boys,Girls}'
  check (cardinality(genders) between 1 and 2 and genders <@ '{Boys,Girls}');
