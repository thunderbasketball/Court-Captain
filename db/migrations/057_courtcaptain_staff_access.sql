-- CourtCaptain staff (SPEC.md section 14): Owners and Admins. Owners add and remove CourtCaptain Admins; Owners can't be
-- removed in the app. The existing CourtCaptain Admins become Owners.
alter table platform_admins add column role text not null default 'Admin' check (role in ('Owner', 'Admin'));
update platform_admins set role = 'Owner';

-- Permission checks: holds the role in the organization, or is CourtCaptain staff, who have Owner-level access to every
-- organization in the background (to give support). Lists of people keep using has_role, so staff don't show there.
create function acts_as(p_coach_id text, p_org text, p_role text) returns boolean language sql stable as $$
  select has_role(p_coach_id, p_org, p_role)
      or (p_role in ('Owner', 'Admin', 'Director') and exists (select 1 from platform_admins where coach_id = p_coach_id))
$$;
revoke all on function acts_as(text, text, text) from public, anon, authenticated;
