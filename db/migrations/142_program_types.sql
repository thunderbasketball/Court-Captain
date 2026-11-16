-- Program types (SPEC.md section 14, Programs). CourtPlayers: a Season (teams formed from player registrations; options
-- Tryouts, Open Gyms, Scrimmages), a Training Session (one day) or a Training Course (several dates; its number of
-- sessions). CourtTeams: a League (pool games over several weeks, then a post-season bracket), a Tournament (a weekend:
-- pool games into a bracket), a Shootout (pool games only) or a Circuit (bulk registration into several Tournaments
-- and/or Shootouts). League and Tournament pick their pool games and Single or Double elimination; a Shootout its pool
-- games.
update player_programs set kind = 'Course' where kind = 'Clinic';
alter table player_programs drop constraint player_programs_kind_check;
alter table player_programs add constraint player_programs_kind_check check (kind in ('Season', 'Session', 'Course'));
alter table player_programs add column scrimmages boolean not null default true;
alter table player_programs add column sessions smallint check (sessions between 1 and 60); -- a Training Course
alter table scenic_programs drop constraint scenic_programs_kind_check;
alter table scenic_programs add constraint scenic_programs_kind_check check (kind in ('League', 'Circuit', 'Tournament', 'Shootout'));
alter table scenic_programs add column pool_games smallint check (pool_games between 1 and 20);
alter table scenic_programs add column elimination text check (elimination in ('single', 'double'));
