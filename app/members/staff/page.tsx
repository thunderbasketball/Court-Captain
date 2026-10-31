import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { directorsPanel, isThunderAdmin } from "@/lib/org-admin";
import { ORGS } from "@/lib/orgs";
import { listUsers } from "@/lib/users";
import AppHeader from "../../AppHeader";
import UserList from "../../UserList";
import MembersNav from "../MembersNav";

export default function StaffPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Users />
    </Suspense>
  );
}

// Members → Staff (Admins only): Admins & Directors, then join requests and everyone else with a login.
async function Users() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (!isThunderAdmin(user)) redirect("/");
  // Admins only: Directors' roles and areas, shown in their rows.
  const panel = await directorsPanel({ pool: db, now: () => new Date() }, user, "thunder");

  return (
    <>
      <AppHeader user={user} tab="members" context="director" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersNav user={user} current="staff" />
        <UserList
          users={await listUsers(user)}
          viewer={user}
          team={panel && { org: "thunder", orgName: ORGS.thunder.name, ...panel }}
        />
      </main>
    </>
  );
}
