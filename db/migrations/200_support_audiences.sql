-- Support for the right people (SPEC.md section 14; lib/support-library.ts): the ready-made questions and guides live in the
-- app's code, each for certain people and features. A row with a `key` is CourtCaptain staff's own version of one of them
-- (or `hidden`: nobody sees it); a row without one is an article staff added, for whoever it's marked for. The first 16 rows
-- (065, updated_by 'setup') are the old articles, shown only by the live site until it has this code.
alter table support_articles
  add column key       text unique check (key ~ '^[a-z0-9-]{2,60}$'),
  add column topic     text,
  add column audiences text[] not null default '{everyone}',
  add column features  text[] not null default '{}',
  add column areas     text[] not null default '{}',
  add column hidden    boolean not null default false;
