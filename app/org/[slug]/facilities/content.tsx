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
import { PageTitle } from "../../../ui";
import SubCard from "../../../SubCard";
import { ChatToggle } from "../../../InlineToggle";
import { ChatIcon, iconBtn } from "../../../CardIcons";
import { orgKey } from "@/lib/chat";
import OrgGyms from "./OrgGyms";
import { GymToolIcons, GymToolPanels } from "../../../GymTools";
import { followRename } from "@/lib/org-rename";

import { PageFrame } from "../../../ui";

const STATUS = {
  pending: ["Request sent, waiting for approval", "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"],
  approved: ["Hosting site", "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"],
  declined: ["Declined", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"],
} as const;

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
  const who = await seesWho(db, user, slug); // Owners and Admins see who did it
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
  const offers = (await hostingOffers(deps, user, slug)) ?? [];

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
        <SubCard title="CourtSync" count={offers.filter((x) => x.status === "approved").length || undefined}>
          <p className="mb-3 text-sm text-zinc-500">
            Ask to host; once a league approves, your gyms marked for that league show as available on its game days, and 🗨️ chats with its schedulers.
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
                {/* Approved: the CourtSync chat with that Scheduler, opened right here. */}
                {x.status === "approved" && (
                  <ChatToggle chatKey={orgKey(x.org, `host-${slug}`)} label={`CourtSync chat with ${x.name}`} className={iconBtn}>
                    <ChatIcon />
                  </ChatToggle>
                )}
                {(x.status === "none" || x.status === "declined") && (
                  <RequestHostingButton hostOrg={slug} forOrg={x.org} name={x.name} again={x.status === "declined"} />
                )}
              </li>
            ))}
          </ul>
        </SubCard>
        </div>
      </PageFrame>
    </>
  );
}
