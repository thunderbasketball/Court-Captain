-- Support chats (SPEC.md section 14): a question asked from Support is a chat with its messages. New until someone
-- answering replies, then Working, until it's marked Resolved. CourtCaptain staff see every chat; an organization's
-- Owners and Admins see the chats started in that organization.
alter table support_questions add column status text not null default 'new' check (status in ('new', 'working', 'resolved')),
  add column resolved_by text, add column resolved_at timestamptz;

create table support_messages (
  id           bigserial primary key,
  question_id  bigint not null references support_questions(id) on delete cascade,
  coach_id     text not null references users(coach_id) on delete cascade,
  body         text not null,
  sent_at      timestamptz not null default now()
);
create index support_messages_chat on support_messages (question_id, sent_at);
alter table support_messages enable row level security;
revoke all on support_messages from anon, authenticated;
revoke all on sequence support_messages_id_seq from anon, authenticated;

-- Questions so far: the question is the chat's first message; an answer becomes a reply and the chat is Working.
insert into support_messages (question_id, coach_id, body, sent_at) select id, coach_id, question, asked_at from support_questions;
insert into support_messages (question_id, coach_id, body, sent_at)
select q.id, coalesce((select a.coach_id from platform_admins a order by a.granted_at limit 1), q.coach_id), q.answer, q.answered_at
from support_questions q where q.answer is not null;
update support_questions set status = 'working' where answer is not null;
