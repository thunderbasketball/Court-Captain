-- When each person last logged in (SPEC.md section 14: Home metrics, coaches' use of the app). Set at every login;
-- filled from the logins the app still has (older ones aren't kept).
alter table users add column last_login_at timestamptz;
update users u set last_login_at = s.last from (select coach_id, max(created_at) as last from sessions group by coach_id) s
where s.coach_id = u.coach_id;
