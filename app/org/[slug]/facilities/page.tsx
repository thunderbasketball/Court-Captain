import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { seesWho } from "@/lib/org-admin";
import { canHost, facilitiesView } from "@/lib/facilities";
import { hostingOffers } from "@/lib/org-partnerships";
import { orgInfo } from "@/lib/org-registry";
import { isOrgSlug } from "@/lib/orgs";
import AppHeader from "../../../AppHeader";
import FacilityCalendar from "../../thunder/facilities/FacilityCalendar";
import { RequestHostingButton } from "../../../hosting/HostingButtons";
import { PageTitle, card } from "../../../ui";
import Link from "next/link";
import FacilitiesNav from "../../thunder/facilities/FacilitiesNav";
import { orgFacilityLinks } from "./links";
import { followRename } from "@/lib/org-rename";

export default function OrgFacilitiesPage({ params }: PageProps<"/org/[slug]/facilities">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgFacilities params={params} />
    </Suspense>
  );
}

const STATUS = {
  pending: ["Request sent, waiting for approval", "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"],
  approved: ["Hosting site", "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"],
  declined: ["Declined", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"],
} as const;

// A registered organization's Facilities (SPEC.md section 14, step 2), for its Admins and Directors of Facilities: its
// gyms and courts, each gym's availability by date (a league's games once it approves it), and asking leagues to
// host their games.
async function OrgFacilities({ params }: { params: PageProps<"/org/[slug]/facilities">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  const who = await seesWho(db, user, slug); // Owners and Admins see who did it
  await followRename(slug, (s) => `/org/${s}/facilities`);
  const o = isOrgSlug(slug) && slug !== "thunder" ? await orgInfo(db, slug) : null;
  if (!o || !(await canHost(db, slug))) notFound();
  const deps = { pool: db, now: () => new Date() };
  const view = await facilitiesView(deps, user, slug);
  if (!view) notFound();
  const offers = (await hostingOffers(deps, user, slug)) ?? [];

  return (
    <>
      <AppHeader user={user} context={`org:${slug}`} tab="org-facilities" />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6">
        <PageTitle title="Facilities" subtitle="Gyms, availability by date, and hosting other organizations' games" />
        <FacilitiesNav current="availability" links={orgFacilityLinks(slug)} />

        <section className={`${card} p-4`}>
          <h2 className="mb-1 font-semibold">Gym availability</h2>
          {!view.gyms.length ? (
            <p className="text-sm text-zinc-500">
              No gyms yet.{" "}
              <Link href={`/org/${slug}/facilities/gyms`} className="font-medium text-thunder-blue hover:underline">
                Add one under Gyms
              </Link>
              .
            </p>
          ) : !view.uses.length ? (
            <p className="text-sm text-zinc-500">{view.partnerNote ?? "Nothing to mark yet."}</p>
          ) : (
            <>
              <p className="mb-4 text-sm text-zinc-500">
                Tap dates, choose what each is for, keep the default hours or set your own, then Save.
              </p>
              <FacilityCalendar
                org={slug}
                today={view.today}
                gyms={view.gyms}
                uses={view.uses}
                days={view.days}
                gameDays={view.gameDays}
              />
            </>
          )}
        </section>

        <section className={`${card} p-4`}>
          <h2 className="mb-1 font-semibold">Host games for other organizations</h2>
          <p className="mb-3 text-sm text-zinc-500">
            Ask to host; once a league approves, your gyms marked for that league show as available on its game days.
          </p>
          {!offers.length && <p className="text-sm text-zinc-500">No organization is looking for hosting sites right now.</p>}
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {offers.map((x) => (
              <li key={x.org} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{x.name}</p>
                  {x.status !== "none" && (
                    <p className="mt-1 text-xs text-zinc-500">
                      <span className={`mr-2 rounded-full px-2 py-0.5 font-semibold ${STATUS[x.status][1]}`}>
                        {STATUS[x.status][0]}
                      </span>
                      Asked by {x.requestedBy}
                      {x.decidedBy && ` · ${x.status === "approved" ? "approved" : "declined"}${who ? ` by ${x.decidedBy}` : ""}`}
                    </p>
                  )}
                </div>
                {(x.status === "none" || x.status === "declined") && (
                  <RequestHostingButton hostOrg={slug} forOrg={x.org} name={x.name} again={x.status === "declined"} />
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
