import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { orgMetadata } from "@/lib/org-metadata";
import { orgInfo } from "@/lib/org-registry";
import { publicLeague, publicLeagues } from "@/lib/public-league";
import { REC_LIMITED, shortDate } from "@/lib/program-options";
import { easternDate } from "@/lib/time";
import OrgLogo from "../../OrgLogo";
import { ProgramSchedule, ProgramTeams } from "../../PublicProgramViews";
import { TeamSignupForm } from "../../register-team/[org]/TeamSignupForm";
import { GRADE_CHOICES } from "@/lib/scenic-teams";
import { openPrograms } from "@/lib/team-signup";
import { card } from "../../ui";
import SubCard from "../../SubCard";
import ShareButton from "../../ShareButton";

export async function generateMetadata({ params }: PageProps<"/league/[org]">): Promise<Metadata> {
  return orgMetadata((await params).org);
}

export default function LeaguePage({ params, searchParams }: PageProps<"/league/[org]">) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
      <Suspense fallback={<p className="text-center text-zinc-500">Loading…</p>}>
        <League params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

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
  const leagues = await publicLeagues(db, now);
  const today = easternDate(now);
  // The League asked for, else the first one still going.
  const pickedId = typeof sp.l === "string" ? sp.l : (leagues.find((l) => l.endsOn >= today) ?? leagues[0])?.id;
  const league = pickedId ? await publicLeague(db, now, pickedId) : null;
  // Register tab while the League's registration is open and Team Registrations is on.
  const canRegister = !!league?.registering && (await hasFeature(db, org, "team-registration"));
  // Register opens right in its card: the organization's name, the person registering and each of its teams.
  const programs = canRegister ? await openPrograms(db, now) : [];
  const tab = typeof sp.tab === "string" ? sp.tab : "";
  const href = (l: string) => `/league/${org}?l=${l}`;

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <OrgLogo src={o.logo} name={o.name} color={o.color} className="size-12 shrink-0 rounded-xl text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{o.name}</h1>
          <p className="text-sm text-zinc-500">League teams and schedule</p>
        </div>
        <ShareButton path={league ? href(league.id) : `/league/${org}`} title={league ? `${o.name}: ${league.name}` : o.name} />
        <Link
          href={`/login/${org}`}
          className="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 hover:bg-blue-50 dark:hover:bg-white/5"
        >
          Log in
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
              <SubCard title="Register" count={`by ${shortDate(league.regCloses)}`} open={tab === "register"}>
                <div className="space-y-3">
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    {shortDate(league.startsOn)} – {shortDate(league.endsOn)} · register by {shortDate(league.regCloses)}
                  </p>
                  {league.recLimited && (
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{REC_LIMITED}. COMP is open to all.</p>
                  )}
                  <TeamSignupForm grades={GRADE_CHOICES} programs={programs} today={today} preset={league.id} />
                </div>
              </SubCard>
            )}
            <SubCard title="Teams" count={league.groups.reduce((n, g) => n + g.teams.length, 0)} open={tab === "teams"}>
              <ProgramTeams org={org} groups={league.groups} wide />
            </SubCard>
            <SubCard title="Schedule" count={league.schedule ? undefined : "not posted yet"} open={tab === "schedule"}>
              <ProgramSchedule days={league.schedule} today={today} />
            </SubCard>
          </div>
        </>
      )}

    </>
  );
}
