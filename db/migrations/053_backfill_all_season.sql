-- Leagues made before Registration Options start with ALL Season at their old per-team fee.
insert into scenic_program_options (program_id, kind, fee_cents)
select id, 'all_season', fee_cents from scenic_programs p
where kind = 'League' and not exists (select 1 from scenic_program_options o where o.program_id = p.id);
