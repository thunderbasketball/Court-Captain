import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { directorsPanel, orgHasArea } from "@/lib/org-admin";
import { orgInfo } from "@/lib/org-registry";
import { formatCell } from "@/lib/phone";
import AppHeader from "../../../AppHeader";
import { AddMenu, DirectorButtons, DirectorRole } from "../../../DirectorTools";
import { PageTitle, PhoneLink, card } from "../../../ui";
import OrgMembersNav from "./OrgMembersNav";

export default function OrgStaffPage({ params }: PageProps<"/org/[slug]/members">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgStaff params={params} />
    </Suspense>
  );
}

// Members → Staff (a registered organization's Admins): its Owners, Admins and Directors with their areas and cells; the
// + Add menu (Directors; Owners also add Admins and Owners). Others with Members go to Coaches.
async function OrgStaff({ params }: { params: PageProps<"/org/[slug]/members">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  const o = await orgInfo(db, slug);
  if (!o || slug === "thunder" || slug === "scenic-city") notFound();
  const panel = await directorsPanel({ pool: db, now: () => new Date() }, user, slug);
  if (!panel) {
    if (await orgHasArea(db, user.coachId, slug, "coaches", "teams")) redirect(`/org/${slug}/members/coaches`);
    notFound();
  }

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-members" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <PageTitle title="Members" subtitle={o.name} />
        <OrgMembersNav slug={slug} current="staff" staff coaches={await hasFeature(db, slug, "team-building")} />
        <section className={`${card} p-4`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Admins &amp; Directors</h2>
            <AddMenu>
              <DirectorButtons
                org={slug}
                areas={panel.areas}
                options={panel.options}
                canManageAdmins={panel.canManageAdmins}
                adminOptions={panel.adminOptions}
                ownerOptions={panel.ownerOptions}
              />
            </AddMenu>
          </div>
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {panel.directors.map((d) => (
              <li key={d.id} className="py-2.5">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
                  {d.name}
                  <PhoneLink cell={d.cell} label={formatCell(d.cell)} />
                </p>
                <DirectorRole
                  org={slug}
                  orgName={o.name}
                  person={d}
                  areas={panel.areas}
                  canManageAdmins={panel.canManageAdmins}
                />
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
