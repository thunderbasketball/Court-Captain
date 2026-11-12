-- CourtTeams' program coaches chat (SPEC.md section 11): "<org>~program-<program id>". Only widens the allowed keys.
alter table chat_messages drop constraint chat_messages_conv_check;
alter table chat_messages add constraint chat_messages_conv_check
  check (conv ~ '^([a-z0-9-]{1,80}~)?(directors|everyone|coaches|team-\d{1,18}|teamcoaches-\d{1,18}|parents-\d{1,18}|coach-\d{7}|event-\d{1,18}|dm-\d{7}-\d{7}|staff-\d{7}-\d{1,18}|heads-\d{7}|host-[a-z0-9-]{1,80}|program-\d{1,18})$');
