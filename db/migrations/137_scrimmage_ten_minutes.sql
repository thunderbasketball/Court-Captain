-- Scrimmages have a start time only and count as 10 minutes (the gym's practice hours, officials, attendance), so
-- scrimmages can start every 10 minutes in a gym. Coming ones are set to 10.
alter table scrimmages drop constraint scrimmages_minutes_check;
alter table scrimmages add constraint scrimmages_minutes_check check (minutes between 10 and 240);
update scrimmages set minutes = 10 where starts_at > now();
