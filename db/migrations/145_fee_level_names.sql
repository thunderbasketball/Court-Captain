-- Each fee of a player program has a name ("Early Bird", "Middle School") as well as its price (SPEC.md section 14).
alter table program_fee_levels add column name text check (length(name) between 1 and 40);
update program_fee_levels set name = 'Fee ' || position where name is null;
