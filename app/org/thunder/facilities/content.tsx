import { redirect } from "next/navigation";
import { hasArea } from "@/lib/org-admin";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { facilitiesView } from "@/lib/facilities";
import { hasFeature } from "@/lib/features";
import AppHeader from "../../../AppHeader";
import { PageTitle } from "../../../ui";
import { Suspense } from "react";
import SubCard from "../../../SubCard";
import { GymToolIcons, GymToolPanels } from "../../../GymTools";
import { GymsContent } from "./gyms/content";
import { TeamGymsContent } from "./team-gyms-content";
import { BLACKOUT_ADD, BlackoutsContent } from "./blackouts/content";
import { AddIcon } from "../../../CardIcons";
import { HostingLeagues } from "../../../hosting/CourtSyncCard";
import { RentalsContent } from "./rentals/content";
import FacilityCalendar from "./FacilityCalendar";

import { PageFrame } from "../../../ui";


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
  const offers = await hasFeature(db, "thunder", "hosting-available"); // CourtSync Host

  return (
    <>
      {!embedded && <AppHeader user={user} tab="facilities" context="director" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6">
        {!embedded && (
          <PageTitle title="Facilities" subtitle="Gyms, availability by date, blackouts, and hosting other organizations' games" />
        )}
        {/* Each part is a card that opens right here (no tabs, no new page). */}
        <div className="space-y-2">
        {/* Gyms: each gym a card with its courts and its availability calendar. */}
        <SubCard title="Gyms" count={view.gyms.length} action={<GymToolIcons org="thunder" />}>
          <GymToolPanels org="thunder" />
          <p className="mb-3 text-sm text-zinc-500">
            Open a gym to mark its dates: tap dates, choose what the courts are for, keep the default hours or set your own, then
            Save.{view.partnerNote && ` ${view.partnerNote}`}
          </p>
          <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
            <GymsContent
              embedded
              calendars={Object.fromEntries(
                view.gyms.map((g) => [
                  g.id,
                  <FacilityCalendar
                    key={g.id}
                    today={view.today}
                    gyms={[g]}
                    uses={view.uses}
                    days={view.days}
                    gameDays={view.gameDays}
                  />,
                ]),
              )}
            />
          </Suspense>
        </SubCard>
        <SubCard title="Team Practice Facilities">
          <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
            <TeamGymsContent />
          </Suspense>
        </SubCard>
        <SubCard title="Blackout Dates" action={<AddIcon id={BLACKOUT_ADD} label="Add blackout dates" />}>
          <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
            <BlackoutsContent embedded />
          </Suspense>
        </SubCard>
        <SubCard title="Rentals" count="coming soon">
          <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
            <RentalsContent embedded />
          </Suspense>
        </SubCard>

        {/* On Home this is in Facilities → CourtSync. */}
        {offers && !embedded && (
          <SubCard title="CourtSync">
            <HostingLeagues org="thunder" user={user} />
          </SubCard>
        )}
        </div>
      </PageFrame>
    </>
  );
}
