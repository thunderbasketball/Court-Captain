-- Chat's setting (SPEC.md section 11; the organization gear → Feature Settings → Chat): email a chat message nobody has
-- seen after this many hours (null = 8), or not at all (chat_emails_on false). Set by the organization's Admins.
alter table organizations
  add column chat_email_hours int check (chat_email_hours between 1 and 72),
  add column chat_emails_on boolean not null default true;
