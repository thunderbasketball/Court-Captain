-- FastBreak page: how many of each organization's teams the last sync saw in Fastbreak, and when.
alter table fastbreak_orgs add column teams int not null default 0;
alter table fastbreak_orgs add column last_seen timestamptz;
