import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { canHost, facilitiesView } from "@/lib/facilities";
import { orgInfo } from "@/lib/org-registry";
import { isOrgSlug } from "@/lib/orgs";
import AppHeader from "../../../AppHeader";
import FacilityCalendar from "../../thunder/facilities/FacilityCalendar";
import { PageTitle } from "../../../ui";
import SubCard from "../../../SubCard";
import { HostingLeagues } from "../../../hosting/CourtSyncCard";
import OrgGyms from "./OrgGyms";
import { GymToolIcons, GymToolPanels } from "../../../GymTools";
import { followRename } from "@/lib/org-rename";

import { PageFrame } from "../../../ui";


// A registered organization's Facilities (SPEC.md section 14, step 2), for its Admins and Directors of Facilities: its
// gyms and courts, each gym's availability by date (a league's games once it approves it), and asking leagues to
// host their games.
export async function OrgFacilitiesContent({
  params,
  embedded = false,
}: {
  params: PageProps<"/org/[slug]/facilities">["params"];
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { slug } = await params;
  await followRename(slug, (s) => `/org/${s}/facilities`);
  const o = isOrgSlug(slug) && slug !== "thunder" ? await orgInfo(db, slug) : null;
  if (!o || !(await canHost(db, slug))) {
    if (embedded) return null;
    notFound();
  }
  const deps = { pool: db, now: () => new Date() };
  const view = await facilitiesView(deps, user, slug);
  if (!view) {
    if (embedded) return null;
    notFound();
  }

  return (
    <>
      {!embedded && <AppHeader user={user} context={`org:${slug}`} tab="org-facilities" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6">
        {!embedded && <PageTitle title="Facilities" subtitle="Gyms, availability by date, and hosting other organizations' games" />}
        {/* Each part is a card that opens right here (no tabs, no new page), the same as Thunder's. */}
        <div className="space-y-2">
        {/* Gyms: each gym a card with its courts and its availability calendar. */}
        <SubCard title="Gyms" count={view.gyms.length} action={<GymToolIcons org={slug} />}>
          <GymToolPanels org={slug} />
          {view.gyms.length > 0 && (
            <p className="mb-3 text-sm text-zinc-500">
              {view.uses.length
                ? "Open a gym to mark its dates: tap dates, choose what each is for, keep the default hours or set your own, then Save."
                : (view.partnerNote ?? "Nothing to mark yet.")}
            </p>
          )}
          <OrgGyms
            org={slug}
            gyms={view.gyms}
            tools={false}
            calendars={
              view.uses.length
                ? Object.fromEntries(
                    view.gyms.map((g) => [
                      g.id,
                      <FacilityCalendar
                        key={g.id}
                        org={slug}
                        today={view.today}
                        gyms={[g]}
                        uses={view.uses}
                        days={view.days}
                        gameDays={view.gameDays}
                      />,
                    ]),
                  )
                : undefined
            }
          />
        </SubCard>
        {/* On Home this is in Facilities → CourtSync. */}
        {!embedded && (
          <SubCard title="CourtSync">
            <HostingLeagues org={slug} user={user} />
          </SubCard>
        )}
        </div>
      </PageFrame>
    </>
  );
}
