import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { orgInfo } from "@/lib/org-registry";
import { isOrgSlug } from "@/lib/orgs";
import type { Metadata } from "next";
import { orgMetadata } from "@/lib/org-metadata";
import LoginFlow from "../LoginFlow";
import { followRename } from "@/lib/org-rename";
import OrgTeams from "./OrgTeams";
import { shortDate } from "@/lib/program-options";
import PublicPrograms, { type ProgramCard } from "./PublicPrograms";
import GamesOfTheWeek from "./GamesOfTheWeek";
import { MyTeams } from "../../FollowTeams";
import { ApplyToOfficiate } from "../../officials/ApplyToOfficiate";
import SubCard from "../../SubCard";
import FindMyPlayer from "../../find-player/FindMyPlayer";
import { heroFor } from "@/lib/public-org";
import PublicHelp from "./PublicHelp";
import { pageCards, publicFacts, publicHelp } from "@/lib/public-facts";
import { myLeagueTeams } from "@/lib/my-league-teams";
import ShareGallery from "./ShareGallery";
import { loadPublicProgram } from "../../league/actions";
import PublicHero from "./PublicHero";
import LoginPanel from "./LoginPanel";
import OurGyms from "./OurGyms";

// The organization's logo as the tab icon (and on a phone's home screen) and its name in the tab title.
export async function generateMetadata({ params }: PageProps<"/login/[org]">): Promise<Metadata> {
  const { org } = await params;
  const base = await orgMetadata(org);
  const o = isOrgSlug(org) ? await orgInfo(db, org) : null;
  if (!o) return base;
  // A texted or posted link shows its name and logo.
  const description = `${o.name}: programs, teams, schedules and standings.`;
  return {
    ...base,
    description,
    metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"),
    openGraph: { title: o.name, description, url: `/login/${org}`, siteName: "CourtCaptain", ...(o.bigLogo ? { images: [o.bigLogo] } : {}) },
  };
}

export default function OrgLoginPage({ params }: PageProps<"/login/[org]">) {
  return (
    // A phone: one column. A wide screen: the banner across, then the login side (left) and the programs (right, wide).
    <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-4 pb-10 lg:max-w-6xl lg:pt-6">
      <Suspense fallback={<p className="text-center text-zinc-500">Loading…</p>}>
        <OrgLogin params={params} />
      </Suspense>
    </main>
  );
}

// Each organization's main page (its login link, SPEC.md section 14): its banner (logo, name,
// season numbers, buttons), the login box, then what anyone may see (My teams, Programs, Teams, gyms, Officials). Logged in: the same page, with "Open <name>" in
// place of the login box (the header's logo leads here).
async function OrgLogin({ params }: { params: PageProps<"/login/[org]">["params"] }) {
  const { org } = await params;
  await followRename(org, (s) => `/login/${s}`);
  const o = isOrgSlug(org) ? await orgInfo(db, org) : null;
  if (!o) notFound();
  const into = `/switch?org=${org}`;
  const user = await currentUser();
  // The organization's programs, no login (open for registration, under way, or ended in the last 30 days), the same for
  // every organization: its team programs (Leagues and the like: tap for Teams and Schedule; outside teams register here
  // while Team Registrations is on), then its player programs (seasons).
  const f = await publicFacts(org, new Date());
  const { today, players, teams, gyms, recruiting, week } = f;
  const mine = user ? await myLeagueTeams(db, user.coachId, org, new Date(), f.own.length > 0) : [];
  const status = (regCloses: string | null, startsOn: string | null, endsOn: string | null) =>
    regCloses && regCloses >= today
      ? `Register by ${shortDate(regCloses)}`
      : startsOn && startsOn > today
        ? `Starts ${shortDate(startsOn)}`
        : endsOn && endsOn >= today
          ? `Under way · ends ${shortDate(endsOn)}`
          : endsOn
            ? `Ended ${shortDate(endsOn)}`
            : "Under way";
  const seasons: ProgramCard[] = f.seasons.map((p) => ({
    id: `p${p.id}`,
    name: p.name,
    kind: p.kind,
    dates: p.starts_on && p.ends_on ? `${shortDate(p.starts_on)} – ${shortDate(p.ends_on)}` : "",
    status: status(p.reg_closes, p.starts_on, p.ends_on),
    logo: null,
    recLimited: false,
    register: false,
    openable: false,
  }));
  const programs: ProgramCard[] = f.own.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    dates: `${shortDate(p.startsOn)} – ${shortDate(p.endsOn)}`,
    status: p.registering
      ? `Register by ${shortDate(p.regCloses)}`
      : p.startsOn > today
        ? `Starts ${shortDate(p.startsOn)}`
        : p.endsOn >= today
          ? `Under way · ends ${shortDate(p.endsOn)}`
          : `Ended ${shortDate(p.endsOn)}`,
    logo: p.logo,
    recLimited: p.recLimited,
    register: f.teamSignup && p.registering,
    openable: true,
  }));
  programs.push(...seasons);
  // The Leagues (another organization's programs) its teams are in, or its gyms host: the same public view, opened right here.
  const leagues: ProgramCard[] = f.leagues.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    dates: `${shortDate(p.startsOn)} – ${shortDate(p.endsOn)}`,
    status: p.startsOn > today ? `Starts ${shortDate(p.startsOn)}` : `Under way · ends ${shortDate(p.endsOn)}`,
    logo: p.logo,
    recLimited: false,
    register: false,
    org: p.org,
    openable: p.org === "scenic-city", // the League page is Scenic City's for now
  }));
  const hero = heroFor({
    org,
    today,
    own: f.own.map((p) => ({ ...p, register: f.teamSignup && p.registering })),
    seasons: f.seasons.map((p) => ({ name: p.name, regCloses: p.reg_closes, startsOn: p.starts_on })),
    leagues: f.leagues,
    teams: teams.length,
    counts: f.counts,
    gyms: gyms.length,
    hosting: f.hosting,
    players,
    recruiting: recruiting.length > 0,
    openable: [...programs, ...leagues].some((p) => p.openable),
  });
  const help = await publicHelp(org);
  const gallery = (await pageCards(org, o.name, f)).map(({ card, v }) => ({ key: card.key, label: card.label, text: card.text, v }));
  // Its one program opens by itself (or, with none and no teams of its own, the one League): something to look at.
  const openables = programs.filter((p) => p.openable);
  const onlyLeague = !openables.length && !teams.length && leagues.length === 1 && leagues[0].openable ? leagues[0] : null;
  const first = openables.length === 1 ? openables[0] : onlyLeague;
  const loaded = first ? await loadPublicProgram(first.org ?? org, first.id) : null;
  const opened = first && loaded?.ok ? { id: first.id, data: loaded } : undefined;
  const right = programs.length > 0 || leagues.length > 0 || teams.length > 0 || gyms.length > 0 || players || recruiting.length > 0 || gallery.length > 0 || help.length > 0;
  return (
    <>
      <PublicHero org={org} name={o.name} color={o.color} logo={o.bigLogo} hero={hero}>
        {user && (
          <Link href={into} className="rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow hover:bg-white/90">
            Open {o.short || o.name} →
          </Link>
        )}
      </PublicHero>
      <div className={`mt-4 lg:mt-6 ${right ? "lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-8" : "mx-auto max-w-sm"}`}>
        {/* Left on a wide screen: the login, My teams and Games of the Week. */}
        <div>
          {devBypass && !user && (
            <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200">
              Testing mode: enter your cell, then code 123456. New numbers become Directors. No emails sent.
            </p>
          )}
          {user ? (
            <p className="px-1 text-sm text-zinc-500">
              Logged in as <span className="font-semibold text-zinc-800 dark:text-zinc-100">{user.firstName}</span>
            </p>
          ) : (
            <LoginPanel>
              {/* Thunder asks a new account why they're joining; any other organization's new account logs straight in. */}
              {/* Other organizations: their Director sets up coaches first, so a cell it doesn't know is told so. */}
              <LoginFlow join={org === "thunder" ? undefined : org} next={into} staffOnly={org === "thunder" ? undefined : o.name} />
            </LoginPanel>
          )}
          {programs.length > 0 && (
            <>
              {/* The person's own teams (logged in) and the teams this device follows (☆ on a program's Standings); on a page
                  that runs Leagues, the teams followed from every organization too. */}
              <MyTeams org={org} mine={mine} everyOrg={f.own.length > 0} />
              {/* The coming Game Day's best REC and COMP matchups (its Leagues, once a schedule is published). */}
              {week && <GamesOfTheWeek week={week} />}
            </>
          )}
        </div>
        {/* Right on a wide screen: Programs (Divisions, Standings, schedules), its teams, gyms, Parents, Officials. */}
        {right && (
          <div className="mt-6 space-y-6 lg:mt-0">
            {/* Pictures to share: registration, the countdown, Games of the Week, officials wanted… from what's true today. */}
            <ShareGallery org={org} items={gallery} />
            {(programs.length > 0 || leagues.length > 0) && (
              <div id="programs" className="scroll-mt-4 space-y-6">
                <PublicPrograms org={org} programs={programs} opened={opened} />
                <PublicPrograms org={org} programs={leagues} title="League" opened={opened} />
              </div>
            )}
            {/* Its teams in a current event, with their League games; ☆ follows one on this device. Names and games only. */}
            <OrgTeams org={org} teams={teams} today={today} />
            {/* A parent: their player's team, practices and games (a code to the email on the registration; no login). */}
            {players && (
              <section id="parents" className="scroll-mt-4 space-y-2">
                <h2 className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Parents</h2>
                <SubCard title="Find my player's team">
                  <FindMyPlayer today={today} />
                </SubCard>
              </section>
            )}
            <OurGyms gyms={gyms} day={f.gymDay} />
            {/* Apply to officiate: this organization's (with Accept recruits on) and its officials groups'. */}
            {recruiting.length > 0 && (
              <section id="officials" className="scroll-mt-4 space-y-2">
                <h2 className="px-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Officials</h2>
                {recruiting.map((r) => (
                  <ApplyToOfficiate key={r.org} org={r.org} name={r.name} />
                ))}
              </section>
            )}
            {help.length > 0 && <PublicHelp articles={help} />}
          </div>
        )}
      </div>
    </>
  );
}
