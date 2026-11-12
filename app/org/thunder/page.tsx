import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { orgFeatures } from "@/lib/features";
import { hasArea, isThunderAdmin } from "@/lib/org-admin";
import { orgMetrics } from "@/lib/org-metrics";
import { visitStats } from "@/lib/site-visits";
import { uniformRequests } from "@/lib/uniforms";
import AppHeader from "../../AppHeader";
import OrgMetrics, { todoCounts } from "../../OrgMetrics";
import { directorAlerts } from "@/lib/director-alerts";
import UniformRequests from "./UniformRequests";
import MembersCards from "../../MembersCards";
import SupportCard from "../../SupportCard";
import { TeamsContent } from "./teams/content";
import { PracticeContent } from "./practice/content";
import { SeasonContent } from "./practice/season/content";
import ProgramsCard, { programCount } from "../../ProgramsCard";
import { GymsContent } from "./facilities/gyms/content";
import { GymToolIcons, GymToolPanels } from "../../GymTools";
import { BLACKOUT_ADD, BlackoutsContent } from "./facilities/blackouts/content";
import { AddIcon } from "../../CardIcons";
import { scheduleLinks } from "../../ScheduleNav";
import { practiceMetrics } from "@/lib/org-metrics";
import SubCard from "../../SubCard";
import { UniformsContent } from "./uniforms/content";
import { FacilitiesContent } from "./facilities/content";
import { MembersContent } from "./members/content";

export default function ThunderHomePage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ThunderHome />
    </Suspense>
  );
}

// Thunder's Home (SPEC.md section 14), the same layout as every organization's: a stack of
// cards, one per part this Director can open (the same parts as the tabs, in the same order): Home (uniform requests and,
// for Owners and Admins, the metrics) open first, then Teams, Schedule, Uniforms, Facilities, Members and Support, each
// loading in the background and opening on its own. Name and logo are in the header.
async function ThunderHome() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (!user.isDirector) redirect("/");
  const features = await orgFeatures(db, "thunder");
  const admin = isThunderAdmin(user);
  // Owners and Admins: the organization's metrics above the cards.
  const now = new Date();
  const [metrics, visits] = admin
    ? await Promise.all([
        orgMetrics({ pool: db, now: () => now }, user, "thunder"),
        visitStats({ pool: db, now: () => now }, user, "thunder"),
      ])
    : [null, null];
  // Directors of Uniforms: players their coaches say need a uniform, to add to the TeamSnap order.
  const requests = features.has("uniforms") ? await uniformRequests({ pool: db, now: () => now }, user) : null;
  // Home as a stack of cards, one per tab this Director can open (the same parts, in the same order): Home first and
  // open; the others load in the background after the page shows (each its own part, streamed) and open on their own.
  // Cards with something to fix flash red: Home (its To Do), Teams (a team missing something or a player not eligible),
  // Uniforms (a number or size missing), Members (join requests), Support (new chats).
  const [flags, todo] = await Promise.all([
    directorAlerts(db, now),
    metrics ? todoCounts(metrics) : null,
  ]);
  // Schedule: Practice and Season (Directors of Practices); practice slots this week and next. Events are Programs' Sessions.
  const schedule = await scheduleLinks(user);
  const practice = schedule.some((l) => l.key === "practice") ? await practiceMetrics(db, now) : null;
  const cards = [
    ...(requests || metrics
      ? [
          {
            key: "home",
            title: "Home",
            alert: (todo?.open ?? 0) > 0 || (requests?.length ?? 0) > 0,
            body: (
              <div className="space-y-3">
                {requests && <UniformRequests list={requests} />}
                {metrics && (
                  <OrgMetrics m={metrics} visits={visits} base="/org/thunder" thunder now={now} roster={hasArea(user, "teams")} />
                )}
              </div>
            ),
          },
        ]
      : []),
    ...(features.has("team-building") && hasArea(user, "teams")
      ? [{ key: "teams", title: "Teams", count: metrics?.teams?.total, alert: flags.teams, body: <TeamsContent embedded /> }]
      : []),
    // Programs (CourtPlayers): Winter 26/27 and the like, with their Sessions (Directors of Events, Owners and Admins).
    ...(features.has("player-registration") && (admin || hasArea(user, "events"))
      ? [{ key: "programs", title: "Programs", count: await programCount("thunder"), body: <ProgramsCard org="thunder" user={user} /> }]
      : []),
    ...(schedule.length
      ? [
          {
            key: "schedule",
            title: "Practice",
            count: practice ? `${practice.thisWeek.booked} booked · ${practice.thisWeek.open} open this week` : undefined,
            body: (
              // Practice: Practice Court Availability (the season's court times at a glance) on top, then this week's
              // numbers and the booking grid.
              <div className="space-y-3">
                <SubCard title="Practice Court Availability">
                  <SeasonContent embedded />
                </SubCard>
                {practice && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    This week: {practice.thisWeek.booked} booked, {practice.thisWeek.open} open · Next week:{" "}
                    {practice.nextWeek.booked} booked, {practice.nextWeek.open} open · {practice.blackoutDays} blackout day
                    {practice.blackoutDays === 1 ? "" : "s"} in 30 days
                  </p>
                )}
                <PracticeContent embedded />
              </div>
            ),
          },
        ]
      : []),
    ...(features.has("uniforms") && hasArea(user, "uniforms")
      ? [{ key: "uniforms", title: "Uniforms", alert: flags.uniforms, body: <UniformsContent embedded /> }]
      : []),
    ...(hasArea(user, "facilities")
      ? [{ key: "facilities", title: "Facilities", body: <FacilitiesContent embedded /> }]
      : hasArea(user, "practices")
        ? [
            {
              key: "facilities",
              title: "Facilities",
              // A Director of Practices (no Facilities area): Gyms and Blackouts, each a card that opens right here.
              body: (
                <div className="space-y-2">
                  <SubCard title="Gyms" action={<GymToolIcons org="thunder" />}>
                    <GymToolPanels org="thunder" />
                    <GymsContent embedded />
                  </SubCard>
                  <SubCard title="Blackout Dates" action={<AddIcon id={BLACKOUT_ADD} label="Add blackout dates" />}>
                    <BlackoutsContent embedded />
                  </SubCard>
                </div>
              ),
            },
          ]
        : []),
    ...(admin || hasArea(user, "teams", "players")
      ? [{ key: "members", title: "Members", alert: (metrics?.waiting.requests ?? 0) > 0, body: <MembersContent embedded /> }]
      : []),
    { key: "support", title: "Support", alert: (metrics?.waiting.newChats ?? 0) > 0, body: <SupportCard user={user} org="thunder" /> },
  ];

  return (
    <>
      <AppHeader user={user} context="director" tab="thunder-home" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersCards cards={cards} open={null} heading={null} />
      </main>
    </>
  );
}
