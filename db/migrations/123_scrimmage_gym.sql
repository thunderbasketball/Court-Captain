-- Scrimmages take a whole gym: courts are its goals (ends of the court), used only for practices. A scrimmage at one of
-- the organization's gyms blocks every goal's practice slots in its time. court_id (121) is left unused.
alter table scrimmages add column gym_id bigint references gyms(id) on delete set null;
create index scrimmages_gym on scrimmages (gym_id, starts_at) where gym_id is not null;
