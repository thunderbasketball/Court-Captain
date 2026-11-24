-- Standard emails: which one was sent (the Season Guide, or the Hosting Guide).
alter table org_guide_sends add column kind text not null default 'season' check (kind in ('season', 'hosting'));
