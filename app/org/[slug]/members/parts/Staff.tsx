import { db } from "@/lib/db";
import { directorsPanel } from "@/lib/org-admin";
import { listOrgMembers } from "@/lib/org-members";
import { orgInfo } from "@/lib/org-registry";
import UserList from "../../../../UserList";

import type { SessionUser } from "@/lib/auth/service";

// Members → Staff card (a registered organization's Admins), like Thunder's: its Owners, Admins and
// Directors with their areas, cell, email and View as; then other logins. The + Add menu: Directors; Owners also add
// Admins and Owners. Directors of Teams go to Coaches.
export default async function OrgStaffPart({ user, slug }: { user: SessionUser; slug: string }) {
  const o = await orgInfo(db, slug);
  if (!o || slug === "thunder" || slug === "scenic-city") return null;
  const panel = await directorsPanel({ pool: db, now: () => new Date() }, user, slug);
  if (!panel) {
    return null;
  }
  const members = await listOrgMembers(db, user, slug);
  if (!members) return null;

  return (
    <>
          <UserList addOnCard users={members.users} viewer={user} orgAdmin team={{ org: slug, orgName: o.name, ...panel }} />
    </>
  );
}
