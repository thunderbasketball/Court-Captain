import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { hasFeature } from "@/lib/features";
import { currentContexts } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { pickWeek, teamChoices, weekGrid } from "@/lib/practice/schedule";
import AppHeader from "../../../AppHeader";
import { PageTitle } from "../../../ui";
import ScheduleNav from "../../../ScheduleNav";
import WeekGridView from "./WeekGridView";
import { hasArea } from "@/lib/org-admin";

import { PageFrame } from "../../../ui";

export async function PracticeContent({
  searchParams = Promise.resolve({}),
  embedded = false,
}: {
  searchParams?: PageProps<"/org/thunder/practice">["searchParams"];
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "thunder", "practice"))) return null;
  } else await requireFeature("thunder", "practice");
  const sp = await searchParams;
  const deps = { pool: db, now: () => new Date() };

  // Team view when asked for (?team=) or when the person's current role is a team; otherwise the Director view.
  const { active } = await currentContexts(user);
  const asked = typeof sp.team === "string" && /^\d{1,18}$/.test(sp.team) ? sp.team : null;
  const teamId = asked ?? (active?.key.startsWith("team:") ? active.key.slice(5) : null);
  if (!teamId && !hasArea(user, "practices")) {
    if (embedded) return null;
    redirect("/");
  }
  const mode = teamId ? "team" : "director";

  const start = await pickWeek(deps, typeof sp.week === "string" ? sp.week : undefined);
  let grid;
  try {
    grid = await weekGrid(deps, user, start, teamId ? { teamId } : "director");
  } catch {
    if (embedded) return null;
    notFound();
  }
  const teams = mode === "director" ? await teamChoices(deps) : [];
  const link = (week: string) => `/org/thunder/practice?week=${week}${asked ? `&team=${asked}` : ""}`;

  return (
    <>
      {!embedded && <AppHeader user={user} tab="schedule" context={mode === "director" ? "director" : `team:${teamId}`} />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {mode === "director" ? (
          <>
            {/* Gyms, blackout dates and practice slots are set up under Facilities. */}
            <PageTitle
              title="Master Practice Schedule"
              subtitle="All practices, open gym slots and blocked dates. Gyms, blackouts and practice times are set under Facilities."
            />
            {!embedded && <ScheduleNav user={user} current="practice" />}
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
      </PageFrame>
    </>
  );
}
