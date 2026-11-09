import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { orgMetadata } from "@/lib/org-metadata";
import { orgInfo } from "@/lib/org-registry";
import { publicLeague, publicLeagues, type PublicDay } from "@/lib/public-league";
import { REC_LIMITED, shortDate } from "@/lib/program-options";
import { easternDate, timeLabel } from "@/lib/time";
import OrgLogo from "../../OrgLogo";
import RegisterChoice from "../../login/[org]/RegisterChoice";
import { card } from "../../ui";

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

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const tabCls = (on: boolean) =>
  `shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${
    on
      ? "border-thunder-orange text-zinc-900 dark:text-white"
      : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
  }`;

// The public League page (SPEC.md section 13): no login, no contact information. Scenic City's Leagues, each with
// its Teams and, once published by a Director of Programs, its Schedule.
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
  const tab = sp.tab === "schedule" ? "schedule" : sp.tab === "register" && canRegister ? "register" : "teams";
  const href = (l: string, t: string) => `/league/${org}?l=${l}&tab=${t}`;

  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <OrgLogo src={o.logo} name={o.name} color={o.color} className="size-12 shrink-0 rounded-xl text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{o.name}</h1>
          <p className="text-sm text-zinc-500">League teams and schedule</p>
        </div>
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
              href={href(l.id, tab)}
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
          <nav aria-label="League" className="mb-4 flex gap-1 border-b border-zinc-200 dark:border-white/10">
            <Link
              href={href(league.id, "teams")}
              aria-current={tab === "teams" ? "page" : undefined}
              className={tabCls(tab === "teams")}
            >
              Teams ({league.groups.reduce((n, g) => n + g.teams.length, 0)})
            </Link>
            <Link
              href={href(league.id, "schedule")}
              aria-current={tab === "schedule" ? "page" : undefined}
              className={tabCls(tab === "schedule")}
            >
              Schedule
            </Link>
            {canRegister && (
              <Link
                href={href(league.id, "register")}
                aria-current={tab === "register" ? "page" : undefined}
                className={tabCls(tab === "register")}
              >
                Register
              </Link>
            )}
          </nav>

          {tab === "register" && (
            <div className={`${card} space-y-3 p-4`}>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                {shortDate(league.startsOn)} – {shortDate(league.endsOn)} · register by {shortDate(league.regCloses)}
              </p>
              {league.recLimited && (
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  {REC_LIMITED}. COMP is open to all.
                </p>
              )}
              <RegisterChoice org={org} programId={league.id} />
            </div>
          )}

          {tab === "teams" &&
            (league.groups.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {league.groups.map((g) => (
                  <section key={g.label} className={`${card} overflow-hidden`}>
                    <h3 className="border-b border-zinc-100 px-4 py-2.5 text-sm font-semibold dark:border-white/5">
                      {g.label} <span className="font-normal text-zinc-500">· {g.teams.length}</span>
                    </h3>
                    <ul className="divide-y divide-zinc-100 text-sm dark:divide-white/5">
                      {g.teams.map((t) => (
                        <li key={t.name} className="px-4 py-2">
                          <span className="font-medium">{t.name}</span> <span className="text-zinc-500">({t.tag})</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <p className={`${card} p-5 text-sm text-zinc-600 dark:text-zinc-300`}>No teams registered yet.</p>
            ))}

          {tab === "schedule" &&
            (league.schedule === null ? (
              <p className={`${card} p-5 text-sm text-zinc-600 dark:text-zinc-300`}>
                The schedule isn&apos;t posted yet. Check back soon.
              </p>
            ) : league.schedule.length ? (
              <Schedule days={league.schedule} today={today} />
            ) : (
              <p className={`${card} p-5 text-sm text-zinc-600 dark:text-zinc-300`}>No games scheduled yet.</p>
            ))}
        </>
      )}

    </>
  );
}

// Game days, the next one open (past ones closed), games by time then gym and court.
function Schedule({ days, today }: { days: PublicDay[]; today: string }) {
  const next = days.find((d) => d.date >= today)?.date ?? days.at(-1)?.date;
  return (
    <div className="space-y-3">
      {days.map((d) => (
        <details key={d.date} className={`${card} group overflow-hidden`} open={d.date === next}>
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
            <span>
              {weekday(d.date)} <span className="font-normal text-zinc-500">· {d.games.length} games</span>
            </span>
            <span aria-hidden className="text-xs text-zinc-400 transition group-open:rotate-90">
              ▶
            </span>
          </summary>
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100 text-sm dark:divide-white/5 dark:border-white/5">
            {d.games.map((g, i) => (
              <li key={i} className="flex gap-3 px-4 py-2.5">
                <span className="w-16 shrink-0 font-medium tabular-nums">{g.starts ? timeLabel(g.starts) : "TBA"}</span>
                <span className="min-w-0">
                  <span className="block">
                    <span className="font-medium">{g.away}</span> <span className="text-zinc-500">at</span>{" "}
                    <span className="font-medium">{g.home}</span>
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {g.group}
                    {g.gym && ` · ${g.gym}${g.court ? `, ${g.court}` : ""}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
