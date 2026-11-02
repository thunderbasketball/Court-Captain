-- Support (SPEC.md section 14), the same in every organization: ready-made questions with answers and step-by-step
-- How-to guides, kept by CourtCaptain staff (who add, change and remove them), and questions people ask from the app.
create table support_articles (
  id          bigserial primary key,
  kind        text not null check (kind in ('faq', 'howto')),
  title       text not null,
  body        text not null,              -- a How-to's steps are one per line
  sort        integer not null default 100,
  updated_by  text not null,
  updated_at  timestamptz not null default now()
);
create table support_questions (
  id           bigserial primary key,
  coach_id     text not null references users(coach_id) on delete cascade,
  org          text references organizations(slug) on delete set null,
  question     text not null,
  asked_at     timestamptz not null default now(),
  answer       text,
  answered_by  text,
  answered_at  timestamptz
);
create index support_questions_asked on support_questions (asked_at desc);
alter table support_articles enable row level security;
alter table support_questions enable row level security;
revoke all on support_articles, support_questions from anon, authenticated;
revoke all on sequence support_articles_id_seq, support_questions_id_seq from anon, authenticated;

insert into support_articles (kind, title, body, sort, updated_by) values
('faq', 'How do I log in?', 'Enter your cell number, then your PIN. If someone added you, your starter PIN is 1234 and you''ll be asked to change it and verify your email the first time.', 10, 'setup'),
('faq', 'I forgot my PIN.', 'On the login page enter your cell, then tap "Forgot PIN?". A code is sent to your verified email; enter it and choose a new PIN.', 20, 'setup'),
('faq', 'How do I switch organizations?', 'Tap the logo next to Log out and pick the organization. Each one opens on its Home page. You can also open My dashboard or create a new organization there.', 30, 'setup'),
('faq', 'Why don''t I see a tab or a button?', 'What you see follows your role (Owner, Admin, Director of an area, Coach) and the features your organization has. Ask your organization''s Admin to give you the area you need, or to turn on the feature in the gear.', 40, 'setup'),
('faq', 'What does COACH INFO MUST BE ENTERED mean?', 'The team has no Head Coach yet. Open the team, tap + Add under Coaches (or Staff) and add the Head Coach with their name and cell. The team is then named after them.', 50, 'setup'),
('faq', 'What does ROSTER MUST BE ENTERED mean?', 'The team has no players yet. Open the team, go to the Roster tab, and tap + Add or Import to enter its players.', 60, 'setup'),
('faq', 'How are team names made?', 'Every team is named top grade + gender + Head Coach''s last name, like 4G Epps. With no Head Coach yet it''s 4G TBD. You can give a team an Alternate name, like Bolts, shown after its name. In a league, your organization''s abbreviation comes first: ER 5B Harris.', 70, 'setup'),
('faq', 'What are 1GG and 2GG?', 'Games guaranteed on that date: 1GG is one game, 2GG is two. ALL Season teams get 1GG every Game Day and play in the Brackets; Add a 2nd Game makes a day 2GG.', 80, 'setup'),
('faq', 'How do I change our logo, color or abbreviation?', 'Admins tap the gear at the right end of the tabs. Organization settings has the Abbreviation, Color and Logo, and the list of features.', 90, 'setup'),
('faq', 'Who can see my information?', 'Your organization''s Admins and the Directors whose area you''re in, and CourtCaptain staff when helping your organization. Other organizations can''t see you.', 100, 'setup'),
('howto', 'Add a team', 'Open Teams and tap + Add.
Pick Boys or Girls, the grade (one, or two next to each other) and REC or COMP.
Pick the Head Coach: someone listed, New person… (name and cell), or No coach yet.
Add an Alternate name if you want one, check the team name shown, then tap Add team.', 10, 'setup'),
('howto', 'Import teams from a spreadsheet', 'Open Teams and tap Import.
Paste rows from your spreadsheet (or choose a CSV file): Gender, Grade, Level, Coach First, Coach Last, Coach Cell, Alternate Name.
Tap Preview and check each row: New, Already a team, or Fix.
Tap Add to add the new ones. Changed your mind? Recent imports at the bottom has Undo.', 20, 'setup'),
('howto', 'Enter a team''s roster', 'Open Teams and tap the team.
Go to the Roster tab.
Tap + Add for one player (first, last, grade, jersey #), or Import to paste many at once.
The ROSTER MUST BE ENTERED warning goes away once there are players.', 30, 'setup'),
('howto', 'Register teams in a league program', 'Open Teams and go to the Register tab.
Find the program and tap Register all unregistered to enter every team as ALL Season.
For Single Days or a 2nd Game, open the team and tap Register (or Add dates) under the program.
Withdraw a date or the team from its page while registration is open.', 40, 'setup'),
('howto', 'Add a gym and offer it for league games', 'Open Facilities, then the Gyms tab, and tap + Add (or Import for several).
Under Availability, ask the league to host: Request to host games.
Once approved, tap dates on the calendar, choose the league, keep the default hours or set your own, and Save.', 50, 'setup'),
('howto', 'Give someone a role', 'Open Members, then Staff, and tap + Add.
Pick Director (choose their areas), Admin, or Owner.
Pick the person from the list, or New person… with their name and cell, and confirm.', 60, 'setup');
