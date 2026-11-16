-- Player program types (SPEC.md section 14, Programs): a Season (players register for the season and are put on teams)
-- or a Clinic / Training (sessions players sign up for; no teams or scrimmages). A Season says whether it has Tryouts
-- and Open Gyms, and both say which grades (and a Season which levels of play) it's for. They decide which Sessions it
-- offers, the grades a Session can have, and which teams can be in its scrimmages.
alter table player_programs drop constraint player_programs_kind_check;
alter table player_programs add constraint player_programs_kind_check check (kind in ('Season', 'Clinic'));
alter table player_programs add column tryouts boolean not null default true;
alter table player_programs add column open_gyms boolean not null default true;
alter table player_programs add column grades text[] not null default '{K,1,2,3,4,5,6,7,8,9,10,11,12}'
  check (cardinality(grades) between 1 and 13 and grades <@ '{K,1,2,3,4,5,6,7,8,9,10,11,12}');
alter table player_programs add column levels text[] not null default '{REC,COMP}'
  check (cardinality(levels) between 1 and 2 and levels <@ '{REC,COMP}');
-- A Clinic / Training's sessions.
insert into event_types (name, created_by) values ('Training', 'setup') on conflict do nothing;
