import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { personOptions } from "@/lib/teams";
import AppHeader from "../../../../AppHeader";
import { PageTitle } from "../../../../ui";
import NewTeamForm from "./NewTeamForm";
import { hasArea } from "@/lib/org-admin";

export default function NewTeamPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <NewTeam />
    </Suspense>
  );
}

async function NewTeam() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "team-building");
  if (!hasArea(user, "teams")) redirect("/");

  const options = await personOptions({ pool: db, now: () => new Date() }, user);
  return (
    <>
      <AppHeader user={user} tab="teams" context="director" />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        <Link href="/org/thunder?open=teams#teams" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          ← Teams
        </Link>
        <div className="mt-2">
          <PageTitle title="New team" subtitle="The name is made for you: top grade + gender + head coach's last name" />
        </div>
        <NewTeamForm users={options.users} volunteers={options.volunteers} />
      </main>
    </>
  );
}
