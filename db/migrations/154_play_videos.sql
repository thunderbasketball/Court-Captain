-- CourtPlaybook: links to videos of a play being run (SPEC.md section 14): up to 5 web addresses (http or https), each
-- shown as a ▶ Video button on the play (YouTube, Vimeo and video files play in a pop-up; others open in a new tab).
alter table plays add column videos text[] not null default '{}' check (cardinality(videos) <= 5);
