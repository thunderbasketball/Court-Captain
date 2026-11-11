import { db } from "@/lib/db";
import { directorsPanel, isThunderAdmin } from "@/lib/org-admin";
import { listUsers } from "@/lib/users";
import UserList from "../../../../UserList";
import { waitingRequests } from "../MembersNav";

import type { SessionUser } from "@/lib/auth/service";

// Members → Requests (Admins only): people asking to join Thunder, to approve or deny.
export default async function RequestsPart({ user }: { user: SessionUser }) {
  if (!isThunderAdmin(user)) return null;
  // Nobody waiting: there's no Requests tab, so go to Staff.
  if (!(await waitingRequests(user))) return null;
  // Admins only: Directors' roles and areas, shown in their rows.
  const panel = await directorsPanel({ pool: db, now: () => new Date() }, user, "thunder");

  return (
    <>
        <UserList
          users={await listUsers(user)}
          viewer={user}
          team={panel && { org: "thunder", orgName: "Thunder Basketball", ...panel }}
          view="requests"
        />
    </>
  );
}
