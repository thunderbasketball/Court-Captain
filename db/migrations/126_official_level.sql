-- An official's Level (SPEC.md section 14, step 4c), set by their Officials Group: typed in (e.g. "Varsity", "Level 2").
alter table org_officials add column level text check (length(level) between 1 and 30);
