import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import Dashboard from "./Dashboard";

export default function MePage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Me />
    </Suspense>
  );
}

// My dashboard: everyone who can log in has one.
async function Me() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  return <Dashboard user={user} coachId={user.coachId} />;
}
