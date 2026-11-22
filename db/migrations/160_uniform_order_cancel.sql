-- Cancel order (Uniforms card → Past orders, the newest order): kept, marked cancelled with who and when; its players
-- count as not sent again.
alter table uniform_vendor_sends add column cancelled_by text, add column cancelled_at timestamptz;
