import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import type { SessionUser } from "@/lib/auth/service";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { orgFeatures, type Feature } from "@/lib/features";
import { directorAreas, isOrgAdmin, type Area } from "@/lib/org-admin";
import { OrgSearchButton } from "../../OrgSearch";
import { scheduleAnalysis } from "@/lib/scenic-analysis";
import { ScheduleAnalysis } from "./ScheduleAnalysis";
import AppHeader from "../../AppHeader";
import MembersCards from "../../MembersCards";
import SubCard from "../../SubCard";
import SupportCard from "../../SupportCard";
import { membersLinks } from "./ScenicNav";
import { ScenicTeamsContent } from "./teams/content";
import { ProgramsContent } from "./programs/content";
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
    title: "Hosting Sites",
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
    about: "Referees and scorekeepers for your games.",
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
  const facilities = shown.has("Game days") || shown.has("Hosting Sites");
  const scheduler = director && areas.includes("scheduling") && features.has("programs");
  const members = director ? await membersLinks(user) : [];
  const cards = [
    ...(director && features.has("programs")
      ? [{ key: "home", title: "Home", body: <Analysis user={user} /> }]
      : []),
    ...(shown.has("Teams") ? [{ key: "teams", title: "Teams", body: <ScenicTeamsContent embedded /> }] : []),
    ...(shown.has("Programs") ? [{ key: "programs", title: "Programs", body: <ProgramsContent embedded /> }] : []),
    ...(scheduler ? [{ key: "scheduler", title: "Scheduler", body: <SchedulerContent embedded /> }] : []),
    ...(facilities
      ? [
          {
            key: "facilities",
            title: "Facilities",
            body: (
              <div className="space-y-2">
                <SubCard title="Game days">
                  <GameDaysContent embedded />
                </SubCard>
                <SubCard title="Courts">
                  <CourtsContent embedded />
                </SubCard>
                <SubCard title="Hosting Sites">
                  <PartnersContent embedded />
                </SubCard>
              </div>
            ),
          },
        ]
      : []),
    ...(members.length
      ? [
          {
            key: "members",
            title: "Members",
            alert: requests > 0,
            body: (
              <div className="space-y-2">
                {members.map((l) =>
                  l.key === "staff" ? (
                    <SubCard key="staff" title="Staff" count={requests ? `${requests} waiting` : undefined} alert={requests > 0}>
                      <ScenicUsersContent embedded />
                    </SubCard>
                  ) : l.key === "hosting-sites" ? (
                    <SubCard key="sites" title="Hosting Sites">
                      <HostingSitesMembersContent embedded />
                    </SubCard>
                  ) : (
                    <SubCard key="coaches" title="Coaches">
                      <ScenicCoachesContent embedded />
                    </SubCard>
                  ),
                )}
              </div>
            ),
          },
        ]
      : []),
    ...(shown.has("Officials")
      ? [{ key: "officials", title: "Officials", count: "coming soon", body: <p className="text-sm text-zinc-500">Referees and scorekeepers for your games. Coming soon.</p> }]
      : []),
    { key: "support", title: "Support", body: <SupportCard user={user} org="scenic-city" /> },
  ];

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scenic-home" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Welcome, {user.firstName} · {scenic.role}
          </p>
          {director && <OrgSearchButton org="scenic-city" orgName="Scenic City" />}
        </div>
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
