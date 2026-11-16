-- A Season with Tryouts has tryout registration dates (SPEC.md section 14): players sign up for its tryouts between
-- them. Its Tryouts sessions (each by gender and grades, on a date) take these sign-up dates unless they set their own.
alter table player_programs add column tryout_reg_opens date;
alter table player_programs add column tryout_reg_closes date;
alter table player_programs add constraint player_programs_tryout_reg check (tryout_reg_closes is null or tryout_reg_opens is null or tryout_reg_closes >= tryout_reg_opens);
