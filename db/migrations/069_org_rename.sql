-- Renaming an organization (SPEC.md section 14): its web address (slug) follows its name, so everything that points at
-- the slug follows a change (on update cascade), and old addresses are kept so old login links and bookmarks still work.
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'f' and c.confupdtype <> 'c'
      and c.connamespace = current_schema()::regnamespace
      and c.confrelid in ('organizations'::regclass, 'org_role_types'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s on update cascade', r.tbl, r.conname, r.def);
  end loop;
end $$;

create table org_old_slugs (
  old_slug    text primary key,
  slug        text not null references organizations(slug) on update cascade on delete cascade,
  changed_by  text not null,
  changed_at  timestamptz not null default now()
);
alter table org_old_slugs enable row level security;
revoke all on org_old_slugs from anon, authenticated;
