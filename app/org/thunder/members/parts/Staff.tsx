import { db } from "@/lib/db";
import { directorsPanel, isThunderAdmin } from "@/lib/org-admin";
import { listUsers } from "@/lib/users";
import UserList from "../../../../UserList";

import type { SessionUser } from "@/lib/auth/service";

// Members → Staff (Admins only): Admins & Directors, then join requests and everyone else with a login.
export default async function StaffPart({ user }: { user: SessionUser }) {
  if (!isThunderAdmin(user)) return null;
  // Admins only: Directors' roles and areas, shown in their rows.
  const panel = await directorsPanel({ pool: db, now: () => new Date() }, user, "thunder");

  return (
    <>
        <UserList
          addOnCard
          users={await listUsers(user)}
          viewer={user}
          team={panel && { org: "thunder", orgName: "Thunder Basketball", ...panel }}
        />
    </>
  );
}
