-- Scrimmages on team schedules (SPEC.md section 14): staff take attendance and parents answer ✓ / ✗, like games.
alter table event_attendance drop constraint event_attendance_kind_check;
alter table event_attendance add constraint event_attendance_kind_check check (kind in ('slot', 'own', 'game', 'scrimmage'));
