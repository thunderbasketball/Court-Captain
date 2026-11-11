import { redirect } from "next/navigation";
import { hasArea, seesWho } from "@/lib/org-admin";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { facilitiesView } from "@/lib/facilities";
import { hasFeature } from "@/lib/features";
import { hostingOffers } from "@/lib/org-partnerships";
import AppHeader from "../../../AppHeader";
import { RequestHostingButton } from "../../../hosting/HostingButtons";
import { PageTitle, card } from "../../../ui";
import FacilitiesNav from "./FacilitiesNav";
import FacilityCalendar from "./FacilityCalendar";

import { PageFrame } from "../../../ui";

const STATUS = {
  pending: ["Request sent, waiting for approval", "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"],
  approved: ["Hosting site", "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"],
  declined: ["Declined", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"],
} as const;

// Thunder Facilities (SPEC.md section 14), Admins and Directors of Facilities: each gym's availability by date
// (Practice Slots, league games, In-House Games, as Thunder's features allow) and hosting other organizations' games.
export async function FacilitiesContent({
  embedded = false,
}: {
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const deps = { pool: db, now: () => new Date() };
  const view = await facilitiesView(deps, user);
  // A Director of Practices only (no Facilities): Gyms and Blackouts.
  if (!view) {
    if (embedded) return null;
    redirect(hasArea(user, "practices") ? "/org/thunder/facilities/gyms" : "/");
  }
  const who = await seesWho(db, user, "thunder"); // Owners and Admins see who did it
  const offers = (await hasFeature(db, "thunder", "hosting-available")) ? await hostingOffers(deps, user, "thunder") : null;

  return (
    <>
      {!embedded && <AppHeader user={user} tab="facilities" context="director" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6">
        <PageTitle title="Facilities" subtitle="Gyms, availability by date, blackouts, and hosting other organizations' games" />
        <FacilitiesNav current="availability" />

        <section className={`${card} p-4`}>
          <h2 className="mb-1 font-semibold">Gym availability</h2>
          <p className="mb-4 text-sm text-zinc-500">
            Tap dates, choose what the courts are for, keep the default hours or set your own, then Save.
            {view.partnerNote && ` ${view.partnerNote}`}
          </p>
          <FacilityCalendar today={view.today} gyms={view.gyms} uses={view.uses} days={view.days} gameDays={view.gameDays} />
        </section>

        {offers && (
          <section className={`${card} p-4`}>
            <h2 className="mb-1 font-semibold">Host games for other organizations</h2>
            <p className="mb-3 text-sm text-zinc-500">
              Ask to host; once an organization approves, Thunder&apos;s dates marked for that league show as available on its
              game days.
            </p>
            {!offers.length && <p className="text-sm text-zinc-500">No organization is looking for hosting sites right now.</p>}
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {offers.map((o) => (
                <li key={o.org} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{o.name}</p>
                    {o.status !== "none" && (
                      <p className="mt-1 text-xs text-zinc-500">
                        <span className={`mr-2 rounded-full px-2 py-0.5 font-semibold ${STATUS[o.status][1]}`}>
                          {STATUS[o.status][0]}
                        </span>
                        Asked by {o.requestedBy}
                        {o.decidedBy &&
                          ` · ${o.status === "approved" ? "approved" : "declined"}${who ? ` by ${o.decidedBy}` : ""}`}
                      </p>
                    )}
                  </div>
                  {(o.status === "none" || o.status === "declined") && (
                    <RequestHostingButton hostOrg="thunder" forOrg={o.org} name={o.name} again={o.status === "declined"} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </PageFrame>
    </>
  );
}
