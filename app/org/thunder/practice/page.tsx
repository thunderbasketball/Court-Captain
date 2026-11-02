import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { currentContexts } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { pickWeek, teamChoices, weekGrid } from "@/lib/practice/schedule";
import AppHeader from "../../../AppHeader";
import { PageTitle } from "../../../ui";
import ScheduleNav from "../../../ScheduleNav";
import WeekGridView from "./WeekGridView";
import { hasArea } from "@/lib/org-admin";

export default function PracticePage({ searchParams }: PageProps<"/org/thunder/practice">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Practice searchParams={searchParams} />
    </Suspense>
  );
}

async function Practice({ searchParams }: { searchParams: PageProps<"/org/thunder/practice">["searchParams"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "practice");
  const sp = await searchParams;
  const deps = { pool: db, now: () => new Date() };

  // Team view when asked for (?team=) or when the person's current role is a team; otherwise the Director view.
  const { active } = await currentContexts(user);
  const asked = typeof sp.team === "string" && /^\d{1,18}$/.test(sp.team) ? sp.team : null;
  const teamId = asked ?? (active?.key.startsWith("team:") ? active.key.slice(5) : null);
  if (!teamId && !hasArea(user, "facilities")) redirect("/");
  const mode = teamId ? "team" : "director";

  const start = await pickWeek(deps, typeof sp.week === "string" ? sp.week : undefined);
  let grid;
  try {
    grid = await weekGrid(deps, user, start, teamId ? { teamId } : "director");
  } catch {
    notFound();
  }
  const teams = mode === "director" ? await teamChoices(deps) : [];
  const link = (week: string) => `/org/thunder/practice?week=${week}${asked ? `&team=${asked}` : ""}`;

  return (
    <>
      <AppHeader user={user} tab="schedule" context={mode === "director" ? "director" : `team:${teamId}`} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {mode === "director" ? (
          <>
            {/* Gyms, blackout dates and practice slots are set up under Facilities. */}
            <PageTitle
              title="Master Practice Schedule"
              subtitle="All practices, open gym slots and blocked dates. Gyms, blackouts and practice times are set under Facilities."
            />
            <ScheduleNav user={user} current="practice" />
          </>
        ) : (
          <>
            <Link href={`/org/thunder/teams/${teamId}`} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
              ← {grid.team?.name}
            </Link>
            <div className="mt-2">
              <PageTitle title="Book practices" subtitle="Every practice at your team's gyms. Book open slots for your team." />
            </div>
          </>
        )}

        <div className="mb-4 flex items-center justify-between gap-2 rounded-xl bg-zinc-100 px-2 py-2 dark:bg-zinc-900">
          <Link href={link(grid.prev)} className="shrink-0 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white hover:bg-zinc-700">
            ← <span className="hidden sm:inline">Previous week</span>
            <span className="sm:hidden">Prev</span>
          </Link>
          <div className="text-center">
            <p className="font-bold">{grid.label}</p>
            {mode === "director" && (
              <p className="text-xs text-zinc-500">
                {grid.counts.open} open · {grid.counts.booked} booked · {grid.counts.blocked} blocked
              </p>
            )}
          </div>
          <Link href={link(grid.next)} className="shrink-0 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white hover:bg-zinc-700">
            <span className="hidden sm:inline">Next week</span>
            <span className="sm:hidden">Next</span> →
          </Link>
        </div>

        <WeekGridView grid={grid} mode={mode} teams={teams} />
      </main>
    </>
  );
}
