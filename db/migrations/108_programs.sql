-- Programs for every organization (SPEC.md section 14, "Where we're going", step 2). Additive: the live site keeps working.
-- A program takes players (CourtPlayers: player_programs) or teams (CourtTeams: scenic_programs, now with its
-- organization). The two tables become one in step 5 ("no special cases").

-- Team programs (League, Circuit, Tournament) belong to an organization: all of today's are Scenic City's.
alter table scenic_programs
  add column org text not null default 'scenic-city' references organizations(slug) on update cascade on delete cascade;

-- Player programs (Season): players register; its Sessions (open gyms, tryouts) have check-in.
create table player_programs (
  id           bigint generated always as identity primary key,
  org          text not null references organizations(slug) on update cascade on delete cascade,
  kind         text not null default 'Season' check (kind in ('Season')),
  name         text not null check (length(name) between 1 and 80),
  reg_opens    date not null,
  reg_closes   date check (reg_closes >= reg_opens),            -- null: open until the season ends
  pay_opens    date,                                             -- registration payment dates (Fees & Payments, later)
  pay_closes   date check (pay_closes >= pay_opens),
  starts_on    date,                                             -- typed in, or taken from season_from
  ends_on      date check (ends_on >= starts_on),
  season_from  bigint references scenic_programs(id) on delete set null, -- season dates from a team program
  created_by   text not null,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz
);
create unique index player_programs_name on player_programs (org, lower(name));
alter table player_programs enable row level security;
revoke all on player_programs from anon, authenticated;

-- Sessions: today's events belong to an organization and (when set) a player program.
alter table events
  add column org text not null default 'thunder' references organizations(slug) on update cascade on delete cascade,
  add column program_id bigint references player_programs(id) on delete set null;
create index events_program on events (program_id);

-- Each registration belongs to a player program. The TeamSnap sync re-inserts every row without it, so a new row
-- gets Thunder's current program (the latest by its season) until the sync sets it itself (step 3, import sources).
alter table registrations add column program_id bigint references player_programs(id) on delete set null;
create function registrations_program() returns trigger language plpgsql as $$
begin
  if new.program_id is null then
    new.program_id := (select id from player_programs where org = 'thunder' order by coalesce(starts_on, reg_opens) desc, id desc limit 1);
  end if;
  return new;
end $$;
revoke all on function registrations_program() from public, anon, authenticated;
create trigger registrations_program before insert on registrations for each row execute function registrations_program();

-- Thunder's Winter 26/27: registration from its first registration, season from Scenic City's current League.
insert into player_programs (org, name, reg_opens, season_from, created_by)
select 'thunder', 'Winter 26/27', coalesce((select min(registered_at)::date from registrations), current_date), p.id, 'setup'
from scenic_programs p
where p.kind = 'League' and exists (select 1 from organizations where slug = 'thunder')
order by p.starts_on desc
limit 1;
update registrations set program_id = (select id from player_programs where org = 'thunder' and name = 'Winter 26/27');
update events set program_id = (select id from player_programs where org = 'thunder' and name = 'Winter 26/27');

-- Session types: Open Gym and Tryouts for now (Group Training and Open Run dropped; no event used them).
delete from event_types where name in ('Group Training', 'Open Run');
