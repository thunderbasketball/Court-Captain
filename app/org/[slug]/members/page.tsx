import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { directorsPanel, orgHasArea } from "@/lib/org-admin";
import { listOrgMembers } from "@/lib/org-members";
import { orgInfo } from "@/lib/org-registry";
import AppHeader from "../../../AppHeader";
import UserList from "../../../UserList";
import OrgMembersNav from "./OrgMembersNav";
import { followRename } from "@/lib/org-rename";

export default function OrgStaffPage({ params }: PageProps<"/org/[slug]/members">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgStaff params={params} />
    </Suspense>
  );
}

// Members → Staff (a registered organization's Admins), like Thunder's: Users and Active, its Owners, Admins and
// Directors with their areas, cell, email and View as; then other logins. The + Add menu: Directors; Owners also add
// Admins and Owners. Directors of Teams go to Coaches.
async function OrgStaff({ params }: { params: PageProps<"/org/[slug]/members">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  await followRename(slug, (s) => `/org/${s}/members`);
  const o = await orgInfo(db, slug);
  if (!o || slug === "thunder" || slug === "scenic-city") notFound();
  const panel = await directorsPanel({ pool: db, now: () => new Date() }, user, slug);
  if (!panel) {
    if (await orgHasArea(db, user.coachId, slug, "teams")) redirect(`/org/${slug}/members/coaches`);
    notFound();
  }
  const members = await listOrgMembers(db, user, slug);
  if (!members) notFound();

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-members" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <OrgMembersNav slug={slug} current="staff" staff coaches={await hasFeature(db, slug, "team-building")} />
        <UserList users={members.users} viewer={user} orgAdmin team={{ org: slug, orgName: o.name, ...panel }} />
      </main>
    </>
  );
}
