import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { currentUser, devBypass } from "@/lib/auth/server";
import type { SessionUser } from "@/lib/auth/service";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { orgFeatures } from "@/lib/features";
import { innerParams } from "@/lib/home-card-href";
import { seesHostDocuments } from "@/lib/host-documents";
import { assignerCount, isOrgAdmin, orgHasArea, type Area } from "@/lib/org-admin";
import { orgMetrics, practiceMetrics } from "@/lib/org-metrics";
import { orgInfo } from "@/lib/org-registry";
import { followRename } from "@/lib/org-rename";
import { isOrgSlug, type OrgSlug } from "@/lib/orgs";
import { gymsWithoutOfficials, officiatesGames, officiatingRequests } from "@/lib/officiating";
import { officiatingSummary } from "@/lib/officiating-schedule";
import { managesOfficials } from "@/lib/officials";
import { directorAlerts } from "@/lib/director-alerts";
import { scheduleAnalysis } from "@/lib/scenic-analysis";
import { uniformRequests } from "@/lib/uniforms";
import AppHeader from "./AppHeader";
import { AddIcon } from "./CardIcons";
import DocumentsCard from "./documents/DocumentsCard";
import { GymToolIcons, GymToolPanels } from "./GymTools";
import MembersCards, { type MemberCard } from "./MembersCards";
import { OrgMetricsWithVisits, todoCounts } from "./OrgMetrics";
import ProgramsCard, { programCount } from "./ProgramsCard";
import SubCard from "./SubCard";
import SupportCard from "./SupportCard";
import OfficialsCard from "./officials/OfficialsCard";
import GamesToOfficiateCard from "./officiating/GamesToOfficiateCard";
import { OfficiatingOffersCard, OfficiatingRequestsCard } from "./officiating/OfficiatingCards";
// Each part's contents (several still read the data where that organization keeps it today: Thunder's own teams,
// practices and uniforms tables, Scenic City's League tables, and every other organization's).
import { OrgTeamsContent } from "./org/[slug]/teams/content";
import { OrgFacilitiesContent } from "./org/[slug]/facilities/content";
import { OrgMembersContent } from "./org/[slug]/members/content";
import { TeamsContent } from "./org/thunder/teams/content";
import { PracticeContent } from "./org/thunder/practice/content";
import { SeasonContent } from "./org/thunder/practice/season/content";
import { UniformsContent } from "./org/thunder/uniforms/content";
import UniformRequests from "./org/thunder/UniformRequests";
import { FacilitiesContent } from "./org/thunder/facilities/content";
import { GymsContent } from "./org/thunder/facilities/gyms/content";
import { BLACKOUT_ADD, BlackoutsContent } from "./org/thunder/facilities/blackouts/content";
import { TeamGymsContent } from "./org/thunder/facilities/team-gyms-content";
import { MembersContent } from "./org/thunder/members/content";
import { ScenicTeamsContent } from "./org/scenic-city/teams/content";
import { SchedulerContent } from "./org/scenic-city/scheduler/content";
import { GameDaysContent } from "./org/scenic-city/game-days/content";
import { CourtsContent } from "./org/scenic-city/courts/content";
import { PartnersContent } from "./org/scenic-city/partners/content";
import { ScenicUsersContent } from "./org/scenic-city/users/content";
import { ScenicCoachesContent } from "./org/scenic-city/members/coaches/content";
import { HostingSitesMembersContent } from "./org/scenic-city/members/hosting-sites/content";
import { ScheduleAnalysis } from "./org/scenic-city/ScheduleAnalysis";

// Every organization's Home (SPEC.md section 14), one page for all: a stack of cards in one order, each shown only when
// the organization has that feature and the person has the role for it, never because of which organization it is:
// Home · Teams · Programs · Scheduler · Practice · Uniforms · Facilities · Documents · Members · Games to officiate ·
// CourtSync · Support. Only open cards are built (`?open=teams,members`); a card's title, count and red alert always show.
export default async function OrgHome({
  org: asked,
  searchParams,
}: {
  org: string;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await followRename(asked, (s) => `/org/${s}`);
  const org: OrgSlug = asked;
  const o = isOrgSlug(org) ? await orgInfo(db, org) : null;
  if (!o) notFound();
  // Anyone with a role there (CourtCaptain staff too, in the background); everyone else goes to their own start page.
  const roles = (
    await db.query<{ role: string }>(
      `select role from org_roles where coach_id = $1 and org = $2 and role <> 'Request'
       union select 'Director' where acts_as($1, $2, 'Director')`,
      [user.coachId, org],
    )
  ).rows.map((r) => r.role);
  if (!roles.length) redirect("/");
  const sp = await searchParams;
  const openCard = typeof sp.open === "string" ? sp.open : null;
  const inner = Promise.resolve(innerParams(sp));
  const here = Promise.resolve({ slug: org });
  const now = new Date();

  const area = (...a: Area[]) => orgHasArea(db, user.coachId, org, ...a);
  const [features, admin, teamsArea, playersArea, eventsArea, programsArea, practicesArea, uniformsArea, facilitiesArea, schedulingArea, officials, clubCoach] =
    await Promise.all([
      orgFeatures(db, org),
      isOrgAdmin(db, user.coachId, org),
      area("teams"),
      area("players"),
      area("events"),
      area("programs"),
      area("practices"),
      area("uniforms"),
      area("facilities"),
      area("scheduling"),
      managesOfficials(db, user, org),
      // Coaches a team of its own (they see their teams on Home).
      db.query("select 1 from org_team_coaches c join org_teams t on t.id = c.team_id where t.org = $1 and c.coach_id = $2 limit 1", [org, user.coachId]),
    ]);
  const has = (f: Parameters<typeof features.has>[0]) => features.has(f);
  // A League's own coaches and solo teams (they register teams in its programs).
  const leagueMember = has("team-registration") && (roles.includes("Solo") || roles.includes("Coach"));

  // What the card titles need (counts and red alerts); the cards' contents are built only when opened.
  const metrics = admin ? await orgMetrics({ pool: db, now: () => now }, user, org) : null;
  const todo = metrics ? todoCounts(metrics) : null;
  const clubTeams = has("team-building") && (teamsArea || !!clubCoach.rowCount);
  const leagueTeams = has("team-registration") && (teamsArea || leagueMember);
  const practiceOn = has("practice") && practicesArea;
  const uniformsOn = has("uniforms") && uniformsArea;
  const hostsGames = has("hosting-available") && facilitiesArea; // its own gyms host other organizations' games
  const leagueFacilities = has("hosting-partners") && facilitiesArea; // a League: game days, courts and hosting organizations
  const ownGyms = has("practice") ? facilitiesArea || practicesArea : hostsGames;
  const scheduler = has("programs") && schedulingArea;
  const [alerts, requests, practice, documents, noOfficials, officiating, toOfficiate, assigners, asking] = await Promise.all([
    // Teams and Uniforms flash while a team or a uniform is missing something (teams kept in Thunder's tables).
    (clubTeams && org === "thunder") || uniformsOn ? directorAlerts(db, now) : null,
    uniformsOn ? uniformRequests({ pool: db, now: () => now }, user) : null,
    practiceOn ? practiceMetrics(db, now) : null,
    seesHostDocuments(db, user, org),
    leagueFacilities ? gymsWithoutOfficials(db, org) : 0,
    // Officials groups asking to officiate its games (a League's Admins and Directors of Scheduling or Programs).
    has("hosting-partners") ? officiatingRequests({ pool: db }, user, org) : null,
    (await officiatesGames(db, org)) ? officiatingSummary({ pool: db, now: () => now }, user, org) : null,
    assignerCount(db, org),
    // People asking to join (Admins), as kept for a League.
    admin ? db.query<{ n: number }>("select count(*)::int as n from access_requests where org = $1", [org]).then((r) => r.rows[0].n) : 0,
  ]);
  const officiatingWait = officiating?.filter((r) => r.status === "pending").length ?? 0;
  const teamAlert = org === "thunder" ? !!alerts?.teams : (metrics?.missing.length ?? 0) > 0;

  // Each part's contents, by where its data is kept (see the imports).
  const teamsBody = (
    <div className="space-y-4">
      {clubTeams && (org === "thunder" ? <TeamsContent searchParams={inner} embedded /> : <OrgTeamsContent params={here} searchParams={inner} embedded />)}
      {leagueTeams && <ScenicTeamsContent searchParams={inner} embedded />}
    </div>
  );
  const facilitiesBody = (
    <div className="space-y-2">
      {ownGyms &&
        (org === "thunder" ? (
          facilitiesArea ? (
            <FacilitiesContent embedded />
          ) : (
            // A Director of Practices (no Facilities area): Gyms, Team Practice Facilities and Blackouts.
            <>
              <SubCard title="Gyms" action={<GymToolIcons org={org} />}>
                <GymToolPanels org={org} />
                <GymsContent embedded />
              </SubCard>
              <SubCard title="Team Practice Facilities">
                <TeamGymsContent />
              </SubCard>
              <SubCard title="Blackout Dates" action={<AddIcon id={BLACKOUT_ADD} label="Add blackout dates" />}>
                <BlackoutsContent embedded />
              </SubCard>
            </>
          )
        ) : (
          <OrgFacilitiesContent params={here} embedded />
        ))}
      {leagueFacilities && (
        <>
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
        </>
      )}
    </div>
  );
  // Members: a League keeps its Staff, Hosting Organizations, Coaches, Officials Groups and Officials as cards; clubs
  // their Staff, Coaches, Players, Families and Officials (inside the part).
  const league = has("hosting-partners");
  const membersBody = league ? (
    <LeagueMembers user={user} org={org} admin={admin} asking={asking} sites={facilitiesArea} coaches={teamsArea || programsArea} officiating={officiating} wait={officiatingWait} officials={officials && has("officials")} />
  ) : org === "thunder" ? (
    <MembersContent searchParams={inner} embedded />
  ) : (
    <OrgMembersContent params={here} searchParams={inner} embedded />
  );
  const showMembers = league
    ? admin || facilitiesArea || teamsArea || programsArea || !!officiating
    : admin || (has("team-building") && teamsArea) || playersArea || officials;

  const cards: MemberCard[] = [
    // Home: uniform requests (Directors of Uniforms), the metrics (Owners and Admins), the schedule analysis (Scheduler).
    ...(metrics || requests || scheduler
      ? [
          {
            key: "home",
            title: "Home",
            alert: (todo?.open ?? 0) > 0 || (requests?.length ?? 0) > 0,
            body: (
              <div className="space-y-3">
                {requests && <UniformRequests list={requests} />}
                {metrics && <OrgMetricsWithVisits user={user} org={org} m={metrics} base={`/org/${org}`} thunder={org === "thunder"} now={now} roster={teamsArea} />}
                {scheduler && <Analysis user={user} />}
              </div>
            ),
          },
        ]
      : []),
    ...(clubTeams || leagueTeams ? [{ key: "teams", title: "Teams", count: metrics?.teams?.total, alert: teamAlert, body: teamsBody }] : []),
    // Programs: seasons players register for (CourtPlayers) and Leagues, Circuits and Tournaments teams register for.
    ...((has("player-registration") || has("team-registration") || has("programs")) && (admin || eventsArea || programsArea || leagueMember)
      ? [{ key: "programs", title: "Programs", count: await programCount(org), body: <ProgramsCard org={org} user={user} /> }]
      : []),
    ...(scheduler ? [{ key: "scheduler", title: "Scheduler", body: <SchedulerContent embedded /> }] : []),
    ...(practiceOn
      ? [
          {
            key: "schedule",
            title: "Practice",
            count: practice ? `${practice.thisWeek.booked} booked · ${practice.thisWeek.open} open this week` : undefined,
            body: (
              <div className="space-y-3">
                <SubCard title="Practice Court Availability">
                  <SeasonContent embedded />
                </SubCard>
                {practice && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    This week: {practice.thisWeek.booked} booked, {practice.thisWeek.open} open · Next week: {practice.nextWeek.booked} booked,{" "}
                    {practice.nextWeek.open} open · {practice.blackoutDays} blackout day{practice.blackoutDays === 1 ? "" : "s"} in 30 days
                  </p>
                )}
                <PracticeContent embedded />
              </div>
            ),
          },
        ]
      : []),
    ...(uniformsOn ? [{ key: "uniforms", title: "Uniforms", alert: !!alerts?.uniforms, body: <UniformsContent embedded /> }] : []),
    ...(ownGyms || leagueFacilities ? [{ key: "facilities", title: "Facilities", alert: noOfficials > 0, body: facilitiesBody }] : []),
    ...(documents ? [{ key: "documents", title: "Documents", body: <DocumentsCard org={org} user={user} /> }] : []),
    ...(showMembers
      ? [
          {
            key: "members",
            title: "Members",
            // Join requests waiting, officials groups asking to officiate, or CourtOfficials without an Assigner.
            alert: (metrics?.waiting.requests ?? 0) > 0 || asking > 0 || officiatingWait > 0 || assigners === 0,
            body: membersBody,
          },
        ]
      : []),
    ...(toOfficiate
      ? [
          {
            key: "games",
            title: "Games to officiate",
            count: toOfficiate.games,
            alert: toOfficiate.open > 0, // referee spots still open
            body: <GamesToOfficiateCard org={org} user={user} />,
          },
        ]
      : []),
    // An Officials Group's CourtSync: ask leagues to officiate their games (its Admins and Officials Assigners).
    ...(toOfficiate ? [{ key: "courtsync", title: "CourtSync", body: <OfficiatingOffersCard org={org} user={user} /> }] : []),
    { key: "support", title: "Support", alert: (metrics?.waiting.newChats ?? 0) > 0, body: <SupportCard user={user} org={org} /> },
  ];

  // The header's chips: the role this Home is shown as.
  const scenic = org === "scenic-city" ? await currentScenic(user) : null;
  const context = org === "thunder" ? "director" : scenic ? scenic.key : `org:${org}`;
  return (
    <>
      <AppHeader user={user} context={context} tab={org === "thunder" ? "thunder-home" : org === "scenic-city" ? "scenic-home" : "org-home"} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersCards cards={cards} open={openCard} heading={null} />
      </main>
    </>
  );
}

// The schedule analysis (Admins and Directors of Scheduling; checked in the lib).
async function Analysis({ user }: { user: SessionUser }) {
  const days = await scheduleAnalysis({ pool: db, now: () => new Date() }, user);
  return days ? <ScheduleAnalysis days={days} /> : <p className="text-sm text-zinc-500">No upcoming Game Days.</p>;
}

// A League's Members: Staff (Admins), Hosting Organizations (Facilities), Coaches (Teams or Programs), Officials Groups
// asking to officiate its games, and its own Officials.
function LeagueMembers({
  user,
  org,
  admin,
  asking,
  sites,
  coaches,
  officiating,
  wait,
  officials,
}: {
  user: SessionUser;
  org: OrgSlug;
  admin: boolean;
  asking: number;
  sites: boolean;
  coaches: boolean;
  officiating: unknown[] | null;
  wait: number;
  officials: boolean;
}): ReactNode {
  return (
    <div className="space-y-2">
      {admin && (
        <SubCard title="Staff" count={asking ? `${asking} waiting` : undefined} alert={asking > 0}>
          <ScenicUsersContent embedded />
        </SubCard>
      )}
      {sites && (
        <SubCard title="Hosting Organizations">
          <HostingSitesMembersContent embedded />
        </SubCard>
      )}
      {coaches && (
        <SubCard title="Coaches">
          <ScenicCoachesContent embedded />
        </SubCard>
      )}
      {officiating && (
        <SubCard title="Officials Groups" count={wait ? `${wait} waiting` : officiating.length} alert={wait > 0}>
          <OfficiatingRequestsCard org={org} user={user} />
        </SubCard>
      )}
      {officials && (
        <SubCard title="Officials">
          <OfficialsCard org={org} user={user} />
        </SubCard>
      )}
    </div>
  );
}
