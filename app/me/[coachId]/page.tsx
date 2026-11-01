import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { adminCanSee } from "@/lib/auth/service";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import Dashboard from "../Dashboard";

export default function PersonDashboardPage({ params }: PageProps<"/me/[coachId]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <PersonDashboard params={params} />
    </Suspense>
  );
}

// Someone else's dashboard: only for an Admin of an organization that person is in (checked on the server).
async function PersonDashboard({ params }: { params: PageProps<"/me/[coachId]">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { coachId } = await params;
  if (coachId === user.coachId) redirect("/me");
  if (user.actingBy || !(await adminCanSee(db, user.coachId, coachId))) notFound();
  return <Dashboard user={user} coachId={coachId} />;
}
