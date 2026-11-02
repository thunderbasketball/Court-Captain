import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { canHost, facilitiesView } from "@/lib/facilities";
import { orgInfo } from "@/lib/org-registry";
import { isOrgSlug } from "@/lib/orgs";
import AppHeader from "../../../../AppHeader";
import FacilitiesNav from "../../../../facilities/FacilitiesNav";
import { PageTitle, card } from "../../../../ui";
import OrgGyms from "../OrgGyms";
import { orgFacilityLinks } from "../links";

export default function OrgGymsPage({ params }: PageProps<"/org/[slug]/facilities/gyms">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgGymsTab params={params} />
    </Suspense>
  );
}

// Facilities → Gyms (a registered organization's Admins and Directors of Facilities): its gyms and courts; + Add and
// Remove (asks first).
async function OrgGymsTab({ params }: { params: PageProps<"/org/[slug]/facilities/gyms">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  const o = isOrgSlug(slug) && slug !== "thunder" ? await orgInfo(db, slug) : null;
  if (!o || !(await canHost(db, slug))) notFound();
  const view = await facilitiesView({ pool: db, now: () => new Date() }, user, slug);
  if (!view) notFound();

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-facilities" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6">
        <PageTitle title="Facilities" subtitle="Gyms, availability by date, and hosting other organizations' games" />
        <FacilitiesNav current="gyms" links={orgFacilityLinks(slug)} />
        <section className={`${card} p-4`}>
          <OrgGyms org={slug} gyms={view.gyms} />
        </section>
      </main>
    </>
  );
}
