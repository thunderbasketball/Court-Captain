import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { orgMetadata } from "@/lib/org-metadata";
import { orgInfo } from "@/lib/org-registry";
import { isOrgSlug } from "@/lib/orgs";
import { currentUser } from "@/lib/auth/server";
import { publicLeague, publicLeagues } from "@/lib/public-league";
import { leagueGyms } from "@/lib/league-gyms";
import LeagueGyms from "../../LeagueGyms";
import { publicly } from "@/lib/public-cache";
import { REC_LIMITED, shortDate } from "@/lib/program-options";
import { easternDate } from "@/lib/time";
import OrgLogo from "../../OrgLogo";
import { ProgramDivisions, ProgramSchedule } from "../../PublicProgramViews";
import { TeamSignupForm } from "../../register-team/[org]/TeamSignupForm";
import { GRADE_CHOICES } from "@/lib/scenic-teams";
import { openPrograms } from "@/lib/team-signup";
import { card } from "../../ui";
import SubCard from "../../SubCard";
import ShareButton from "../../ShareButton";
import TeamFinder from "../../TeamFinder";
import FindMyPlayer from "../../find-player/FindMyPlayer";

export async function generateMetadata({ params }: PageProps<"/league/[org]">): Promise<Metadata> {
  return orgMetadata((await params).org);
}

export default function LeaguePage({ params, searchParams }: PageProps<"/league/[org]">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 lg:max-w-6xl">
      <Suspense fallback={<p className="text-center text-zinc-500">Loading…</p>}>
        <League params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const HomeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
    <path d="M3 11.5 12 4l9 7.5M5.5 10v9a1 1 0 0 0 1 1H10v-5h4v5h3.5a1 1 0 0 0 1-1v-9" />
  </svg>
);

// The public League page (SPEC.md section 13): no login, no contact information. Scenic City's Leagues, each with
// its Teams and, once published by a Director of Programs, its Schedule, as cards that open in place (an old ?tab= link
// opens that card). Share sends the League's link.
async function League({
  params,
  searchParams,
}: {
  params: PageProps<"/league/[org]">["params"];
  searchParams: PageProps<"/league/[org]">["searchParams"];
}) {
  const { org } = await params;
  if (org !== "scenic-city" || !(await hasFeature(db, org, "programs"))) notFound();
  const o = await orgInfo(db, org);
  if (!o) notFound();
  const sp = await searchParams;
  const now = new Date();
  const today = easternDate(now);
  const leagues = await publicly(`leagues:${today}`, () => publicLeagues(db, now));
  // The League asked for, else the first one still going.
  const pickedId = typeof sp.l === "string" ? sp.l : (leagues.find((l) => l.endsOn >= today) ?? leagues[0])?.id;
  const league = leagues.some((l) => l.id === pickedId) ? await publicly(`league:${today}:${pickedId}`, () => publicLeague(db, now, pickedId)) : null;
  const gyms = league ? await publicly(`league-gyms:${today}:${league.id}`, () => leagueGyms(db, now, league.id)) : [];
  const players = await hasFeature(db, org, "player-registration");
  // Register tab while the League's registration is open and Team Registrations is on.
  // Only on the League's own public page: not when they came from another organization's.
  const fromOther = typeof sp.from === "string" && sp.from !== org;
  const canRegister = !fromOther && !!league?.registering && (await hasFeature(db, org, "team-registration"));
  // Register opens right in its card: the organization's name, the person registering and each of its teams.
  const programs = canRegister ? await openPrograms(db, now) : [];
  const tab = typeof sp.tab === "string" ? sp.tab : "";
  // Where they came from (an organization's page), else the League's own page.
  const asked = typeof sp.from === "string" && isOrgSlug(sp.from) ? await orgInfo(db, sp.from) : null;
  const back = asked ?? o;
  const user = await currentUser();
  const href = (l: string) => `/league/${org}?l=${l}${asked ? `&from=${asked.slug}` : ""}`;

  return (
    <>
      <Link href={`/login/${back.slug}`} className="mb-3 inline-block rounded-full px-3 py-1.5 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-white/5">
        ← Back to {back.name}
      </Link>
      <div className="mb-5 flex items-center gap-3">
        <OrgLogo src={o.logo} name={o.name} color={o.color} className="size-12 shrink-0 rounded-xl text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{o.name}</h1>
          <p className="text-sm text-zinc-500">League teams, schedule and gyms</p>
        </div>
        <ShareButton path={league ? `/league/${org}?l=${league.id}` : `/league/${org}`} title={league ? `${o.name}: ${league.name}` : o.name} label={`Share ${league?.name ?? o.name}`} />
        <Link
          href={user ? "/" : `/login/${org}`}
          aria-label={user ? "My home" : "Log in"}
          title={user ? "My home" : "Log in"}
          className={
            user
              ? "grid size-8 shrink-0 place-items-center rounded-full text-thunder-blue hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-white/5"
              : "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 hover:bg-blue-50 dark:hover:bg-white/5"
          }
        >
          {user ? <HomeIcon /> : "Log in"}
        </Link>
      </div>

      {!leagues.length && <p className={`${card} p-5 text-sm text-zinc-600 dark:text-zinc-300`}>No League right now.</p>}

      {leagues.length > 1 && (
        <nav aria-label="Leagues" className="mb-4 flex flex-wrap gap-2">
          {leagues.map((l) => (
            <Link
              key={l.id}
              href={href(l.id)}
              aria-current={l.id === league?.id ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
                l.id === league?.id
                  ? "bg-thunder-blue text-white ring-thunder-blue"
                  : "text-zinc-700 ring-zinc-950/15 hover:bg-zinc-50 dark:text-zinc-200 dark:ring-white/20"
              }`}
            >
              {l.name}
            </Link>
          ))}
        </nav>
      )}

      {league && (
        <>
          <div className="mb-2 flex items-center gap-3">
            {league.logo && (
              // eslint-disable-next-line @next/next/no-img-element -- an uploaded image served by /program-logo
              <img src={league.logo} alt="" className="size-12 shrink-0 rounded-xl object-contain" />
            )}
            <h2 className="text-lg font-semibold">{league.name}</h2>
          </div>
          <div className="space-y-2">
            {canRegister && (
              <SubCard title="Register new teams" count={`by ${shortDate(league.regCloses)}`} open={tab === "register"}>
                <div className="space-y-3">
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    {shortDate(league.startsOn)} – {shortDate(league.endsOn)} · register by {shortDate(league.regCloses)}
                  </p>
                  {league.recLimited && (
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{REC_LIMITED}. COMP is open to all.</p>
                  )}
                  <TeamSignupForm org={org} grades={GRADE_CHOICES} programs={programs} today={today} preset={league.id} />
                </div>
              </SubCard>
            )}
            {fromOther && (
              <SubCard title="Find your team" open={tab === "find"}>
                <TeamFinder org={org} league={league.name} />
              </SubCard>
            )}
            {/* Division → REC / COMP → Grade (Standings, then its Schedule by date). */}
            <SubCard title="Teams" count={league.groups.reduce((n, g) => n + g.teams.length, 0)} open={tab === "teams"}>
              <ProgramDivisions org={org} program={league.id} groups={league.groups} schedule={league.schedule} today={today} soon={league.soon} />
            </SubCard>
            <SubCard title="Schedule" count={league.schedule ? undefined : "not posted yet"} open={tab === "schedule"}>
              <ProgramSchedule days={league.schedule} today={today} soon={league.soon} />
            </SubCard>
            {/* Where its games are: each gym's address, Directions, host and coming published games. */}
            <SubCard title="Gyms" count={gyms.length || undefined} open={tab === "gyms"}>
              <LeagueGyms gyms={gyms} />
            </SubCard>
            {/* Only an organization that registers players (CourtPlayers), as on its main page. */}
            {players && (
              <SubCard title="Find my player's team" open={tab === "find"}>
                <FindMyPlayer today={today} />
              </SubCard>
            )}
          </div>
        </>
      )}

    </>
  );
}
