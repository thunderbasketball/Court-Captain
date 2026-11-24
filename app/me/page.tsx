import { Suspense } from "react";
import PageOutline from "../PageOutline";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import Dashboard from "./Dashboard";

export default function MePage() {
  return (
    <Suspense fallback={<PageOutline />}>
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
