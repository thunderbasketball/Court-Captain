-- Chat for every organization with the Chat feature (SPEC.md section 11). Thunder's chats keep their keys
-- ("coaches", "team-12"…); another organization's are stored as "<slug>~<key>" ("east-ridge~coaches"), so the same
-- chat name in two organizations never mixes and Thunder's rows (and the live site's code) are unchanged. `org` says
-- whose chat it is: renaming an organization updates it (and the key's prefix, in lib/org-signup.ts renameOrg);
-- deleting one takes its chats.
alter table chat_messages
  add column org text not null default 'thunder' references organizations(slug) on update cascade on delete cascade;
alter table chat_reads
  add column org text not null default 'thunder' references organizations(slug) on update cascade on delete cascade;
alter table chat_messages drop constraint chat_messages_conv_check;
alter table chat_messages add constraint chat_messages_conv_check
  check (conv ~ '^([a-z0-9-]{1,80}~)?(directors|everyone|coaches|team-\d{1,18}|teamcoaches-\d{1,18}|coach-\d{7}|event-\d{1,18}|dm-\d{7}-\d{7}|staff-\d{7}-\d{1,18}|heads-\d{7})$');
create index chat_messages_org on chat_messages (org, conv);
