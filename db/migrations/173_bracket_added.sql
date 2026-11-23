-- A League team put in the Brackets by hand (SPEC.md section 14; the FastBreak list adds teams in FastBreak's
-- Championship): it plays in the Brackets on top of the usual rule (ALL Season, or at least half the Game Days). Who
-- added it and when are recorded.
alter table scenic_registrations
  add column bracket_by text,
  add column bracket_at timestamptz;
