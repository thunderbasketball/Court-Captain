import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { memberLinks } from "./MembersNav";

export default function MembersPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <FirstPart />
    </Suspense>
  );
}

// Members opens the first part this person can see.
async function FirstPart() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  redirect(memberLinks(user)[0]?.href ?? "/");
  return null;
}
