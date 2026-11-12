import { Suspense } from "react";
import { gymsWithoutOfficials, officiatingRequests } from "@/lib/officiating";
import { OfficiatingRequestsCard } from "../../officiating/OfficiatingCards";
import OfficialsCard, { officialsCount } from "../../officials/OfficialsCard";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import type { SessionUser } from "@/lib/auth/service";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { orgFeatures, type Feature } from "@/lib/features";
import { directorAreas, isOrgAdmin, type Area } from "@/lib/org-admin";
import { scheduleAnalysis } from "@/lib/scenic-analysis";
import { ScheduleAnalysis } from "./ScheduleAnalysis";
import AppHeader from "../../AppHeader";
import MembersCards from "../../MembersCards";
import SubCard from "../../SubCard";
import SupportCard from "../../SupportCard";
import { membersLinks } from "./ScenicNav";
import { ScenicTeamsContent } from "./teams/content";
import ProgramsCard, { programCount } from "../../ProgramsCard";
import { SchedulerContent } from "./scheduler/content";
import { GameDaysContent } from "./game-days/content";
import { CourtsContent } from "./courts/content";
import { PartnersContent } from "./partners/content";
import { ScenicUsersContent } from "./users/content";
import { ScenicCoachesContent } from "./members/coaches/content";
import { HostingSitesMembersContent } from "./members/hosting-sites/content";

export default function ScenicPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Scenic />
    </Suspense>
  );
}

// What Scenic City offers, by role and by the features it has (SPEC.md sections 13-14). Parts without a link come later.
// For the Director chip: `area` needs that Director area, `admin` needs an Admin (Admins have every area).
const PARTS: { title: string; about: string; who: string[]; href?: string; feature?: Feature; area?: Area; admin?: boolean }[] = [
  {
    title: "Teams",
    about: "Every team, by division or by organization; add or import outside clubs' teams.",
    who: ["Director", "Solo", "Coach"],
    href: "/org/scenic-city/teams",
    feature: "team-registration",
    area: "teams",
  },
  {
    title: "Programs",
    about: "League, Circuit and Tournament: divisions, game and bracket days, and registered teams.",
    who: ["Director", "Solo", "Coach"],
    href: "/org/scenic-city/programs",
    feature: "programs",
    area: "programs",
  },
  {
    title: "Game days",
    about: "The dates Scenic City plays, from each program (under Facilities).",
    who: ["Director"],
    href: "/org/scenic-city/game-days",
    feature: "hosting-partners",
    area: "facilities",
  },
  {
    title: "Hosting Organizations",
    about: "Organizations and schools that host games: their gyms, courts and open hours (under Facilities).",
    who: ["Director"],
    href: "/org/scenic-city/partners",
    feature: "hosting-partners",
    area: "facilities",
  },
  {
    title: "Members",
    about: "Staff and join requests, hosting sites' Owners and Admins, and each program's coaches.",
    who: ["Director"],
    href: "/org/scenic-city/users",
    admin: true,
  },
  {
    title: "Officials",
    about: "Your referees (CourtSync): add them by cell; assigning them to games comes next.",
    who: ["Director"],
    feature: "officials",
    area: "officials",
  },
];

// Scenic City home: only for people who hold a Scenic City role (checked on the server).
async function Scenic() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const scenic = await currentScenic(user);
  if (!scenic) redirect("/");
  const features = await orgFeatures(db, "scenic-city");
  const director = scenic.role === "Director";
  const [admin, areas] = director
    ? await Promise.all([isOrgAdmin(db, user.coachId, "scenic-city"), directorAreas(db, user.coachId, "scenic-city")])
    : [false, [] as Area[]];
  const parts = PARTS.filter(
    (p) =>
      p.who.includes(scenic.role) &&
      (!p.feature || features.has(p.feature)) &&
      (!director || ((!p.area || areas.includes(p.area)) && (!p.admin || admin))),
  );
  const requests = admin
    ? (await db.query<{ n: number }>("select count(*)::int as n from access_requests where org = 'scenic-city'")).rows[0].n
    : 0;

  // Home as a stack of cards, one per part this person can open (the same as every organization's): Home (the
  // schedule analysis) first, then Teams, Programs, Scheduler, Facilities (Game days, Courts, Hosting Sites), Members
  // (Staff, Hosting Sites, Coaches), Officials and Support. Each loads in the background and opens on its own.
  const shown = new Set(parts.map((p) => p.title));
  const facilities = shown.has("Game days") || shown.has("Hosting Organizations");
  // Hosting gyms without an officials group: the Hosting Organizations and Facilities cards flash.
  const noOfficials = facilities ? await gymsWithoutOfficials(db, "scenic-city") : 0;
  const scheduler = director && areas.includes("scheduling") && features.has("programs");
  const members = director ? await membersLinks(user) : [];
  // Officials groups asking to officiate its games (Admins and Directors of Scheduling or Programs).
  const officiating = director ? await officiatingRequests({ pool: db }, user, "scenic-city") : null;
  const officiatingWait = officiating?.filter((r) => r.status === "pending").length ?? 0;
  const cards = [
    ...(director && features.has("programs")
      ? [{ key: "home", title: "Home", body: <Analysis user={user} /> }]
      : []),
    ...(shown.has("Teams") ? [{ key: "teams", title: "Teams", body: <ScenicTeamsContent embedded /> }] : []),
    // Programs: the same card as every organization's (its programs open right there).
    ...(shown.has("Programs")
      ? [{ key: "programs", title: "Programs", count: await programCount("scenic-city"), body: <ProgramsCard org="scenic-city" user={user} /> }]
      : []),
    ...(scheduler ? [{ key: "scheduler", title: "Scheduler", body: <SchedulerContent embedded /> }] : []),
    ...(facilities
      ? [
          {
            key: "facilities",
            title: "Facilities",
            alert: noOfficials > 0,
            body: (
              <div className="space-y-2">
                <SubCard title="Game days">
                  <GameDaysContent embedded />
                </SubCard>
                <SubCard title="Courts">
                  <CourtsContent embedded />
                </SubCard>
                <SubCard
                  title="Hosting Organizations"
                  count={noOfficials ? `${noOfficials} ${noOfficials === 1 ? "gym" : "gyms"} without officials` : undefined}
                  alert={noOfficials > 0}
                >
                  <PartnersContent embedded />
                </SubCard>
              </div>
            ),
          },
        ]
      : []),
    ...(members.length || officiating
      ? [
          {
            key: "members",
            title: "Members",
            alert: requests > 0 || officiatingWait > 0,
            body: (
              <div className="space-y-2">
                {members.map((l) =>
                  l.key === "staff" ? (
                    <SubCard key="staff" title="Staff" count={requests ? `${requests} waiting` : undefined} alert={requests > 0}>
                      <ScenicUsersContent embedded />
                    </SubCard>
                  ) : l.key === "hosting-sites" ? (
                    <SubCard key="sites" title="Hosting Organizations">
                      <HostingSitesMembersContent embedded />
                    </SubCard>
                  ) : (
                    <SubCard key="coaches" title="Coaches">
                      <ScenicCoachesContent embedded />
                    </SubCard>
                  ),
                )}
                {officiating && (
                  <SubCard
                    title="Officials Groups"
                    count={officiatingWait ? `${officiatingWait} waiting` : officiating.length}
                    alert={officiatingWait > 0}
                  >
                    <OfficiatingRequestsCard org="scenic-city" user={user} />
                  </SubCard>
                )}
              </div>
            ),
          },
        ]
      : []),
    // Officials (CourtSync Scheduler): its referees, with + to add; assigning them to games comes next.
    ...(shown.has("Officials")
      ? [{ key: "officials", title: "Officials", count: await officialsCount("scenic-city"), body: <OfficialsCard org="scenic-city" user={user} /> }]
      : []),
    { key: "support", title: "Support", body: <SupportCard user={user} org="scenic-city" /> },
  ];

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scenic-home" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersCards cards={cards} open={null} heading={null} />
      </main>
    </>
  );
}

// Schedule analysis: Admins and Directors of Scheduling (null for anyone else, checked in the lib).
async function Analysis({ user }: { user: SessionUser }) {
  const days = await scheduleAnalysis({ pool: db, now: () => new Date() }, user);
  return days ? <ScheduleAnalysis days={days} /> : <p className="text-sm text-zinc-500">No upcoming Game Days.</p>;
}
