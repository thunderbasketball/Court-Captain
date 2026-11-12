-- Team warnings (SPEC.md section 14, Teams card → Warnings): which warnings an organization turns on and their numbers,
-- as {"roster":{"on":true,"min":8},"idle":{"on":true,"days":14},"uniforms":{"on":true}}. Null = the defaults (all on,
-- fewer than 8 players, no app visit in 14 days). Set in the Warnings card's gear by the organization's Admins.
alter table organizations
  add column team_warnings jsonb,
  add column team_warnings_by text,
  add column team_warnings_at timestamptz;
