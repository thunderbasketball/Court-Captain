import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { isScenicFacilities } from "@/lib/scenic";
import { listGameDays, openCourtsByDay } from "@/lib/scenic-partners";
import { currentScenic } from "@/lib/contexts-server";
import { dayLabel, localParts } from "@/lib/time";
import AppHeader from "../../../AppHeader";
import { FacilitiesNav } from "../ScenicNav";
import { PageTitle, card } from "../../../ui";
import GameDayCalendar from "./GameDayCalendar";

import { PageFrame } from "../../../ui";
import { hasFeature } from "@/lib/features";

// Scenic City game days on a calendar, view only: set by each program's Game & Bracket Days, with how many hosting
// sites' courts are open each day. Admins and Directors of Facilities, on the Director chip.
export async function GameDaysContent({
  embedded = false,
}: {
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "scenic-city", "hosting-partners"))) return null;
  } else await requireFeature("scenic-city", "hosting-partners");
  const deps = { pool: db, now: () => new Date() };
  const days = await listGameDays(deps, user);
  if (!days) {
    if (embedded) return null;
    redirect("/");
  }
  const scenic = await currentScenic(user);
  if (!scenic) {
    if (embedded) return null;
    redirect("/");
  }
  // Facilities is for the Director chip of Admins and Directors of Facilities only (coaches have no reason to see it).
  if (scenic.role !== "Director" || !(await isScenicFacilities(db, user.coachId))) {
    if (embedded) return null;
    redirect("/org/scenic-city");
  }
  const byId = (await openCourtsByDay(deps, user)) ?? {};
  const openCourts = Object.fromEntries(days.filter((d) => byId[d.id]).map((d) => [d.day, byId[d.id]]));
  const t = localParts(new Date());
  const today = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;

  return (
    <>
      {!embedded && <AppHeader user={user} context={scenic.key} tab="scenic-facilities" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        {!embedded && <FacilitiesNav user={user} current="game-days" />}
        <PageTitle
          title="Game days"
          subtitle={`${days.length} upcoming, set by each program's Game & Bracket Days (change them on the program). Hosting sites give their courts' hours on these days.`}
        />
        <div className={`${card} p-4`}>
          <GameDayCalendar today={today} days={days.map((d) => d.day)} openCourts={openCourts} />
        </div>
        {days.length > 0 && (
          <section className={`${card} mt-4 overflow-hidden`}>
            <h2 className="px-4 pt-4 pb-2 font-semibold">Upcoming game days</h2>
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
              {days.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium whitespace-nowrap">{dayLabel(d.day)}</span>
                  <span className="text-right text-zinc-600 dark:text-zinc-300">
                    {d.programs.length ? d.programs.join(", ") : <span className="text-zinc-400">No program yet</span>}
                    {openCourts[d.day] ? (
                      <span className="block text-xs text-emerald-700 dark:text-emerald-300">
                        {openCourts[d.day]} court{openCourts[d.day] === 1 ? "" : "s"} open
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </PageFrame>
    </>
  );
}
