import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { seasonCalendar } from "@/lib/practice/schedule";
import AppHeader from "../../../../AppHeader";
import { PageTitle, card } from "../../../../ui";
import ScheduleNav from "../../../../ScheduleNav";
import { hasArea } from "@/lib/org-admin";

import { PageFrame } from "../../../../ui";
import { hasFeature } from "@/lib/features";

// A calendar of the whole season: which days have practice slots, how many are booked, and which are blocked.
export async function SeasonContent({
  embedded = false,
}: {
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "thunder", "practice"))) return null;
  } else await requireFeature("thunder", "practice");
  if (!hasArea(user, "practices")) {
    if (embedded) return null;
    redirect("/");
  }
  const months = await seasonCalendar({ pool: db, now: () => new Date() }, user);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  return (
    <>
      {!embedded && <AppHeader user={user} tab="schedule" context="director" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <PageTitle title="Season calendar" subtitle="Practice days at a glance. Tap a day to open that week." />
        {!embedded && <ScheduleNav user={user} current="season" />}
        <div className="mb-4 flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded bg-emerald-500" /> Open slots
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded bg-violet-500" /> Booked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-3 rounded bg-red-500" /> Blacked out
          </span>
        </div>
        {!months.length && <p className="text-zinc-500">No practice slots yet.</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {months.map((m) => (
            <section key={m.label} className={`${card} p-4`}>
              <h2 className="mb-2 font-semibold">{m.label}</h2>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-zinc-400">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <span key={i}>{d}</span>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {Array.from({ length: m.firstWeekday }, (_, i) => (
                  <span key={`pad${i}`} />
                ))}
                {m.days.map((d) => {
                  const total = d.open + d.booked + d.blocked;
                  const allBlocked = total > 0 && d.blocked === total;
                  const cls = !total
                    ? "text-zinc-300 dark:text-zinc-600"
                    : allBlocked
                      ? "bg-red-100 text-red-700 ring-1 ring-red-300 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30"
                      : "bg-zinc-50 text-zinc-900 ring-1 ring-zinc-200 hover:ring-thunder-blue dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/10";
                  const body = (
                    <>
                      <span className={`text-xs font-semibold ${d.iso === today ? "rounded-full bg-thunder-orange px-1 text-white" : ""}`}>
                        {d.day}
                      </span>
                      {total > 0 && (
                        <span className="mt-0.5 flex justify-center gap-0.5">
                          {d.open > 0 && <span className="size-1.5 rounded-full bg-emerald-500" />}
                          {d.booked > 0 && <span className="size-1.5 rounded-full bg-violet-500" />}
                          {d.blocked > 0 && <span className="size-1.5 rounded-full bg-red-500" />}
                        </span>
                      )}
                    </>
                  );
                  return total ? (
                    <Link
                      key={d.iso}
                      href={`/org/thunder/practice?week=${d.iso}`}
                      title={`${d.open} open · ${d.booked} booked · ${d.blocked} blocked`}
                      className={`flex aspect-square flex-col items-center justify-center rounded-md ${cls}`}
                    >
                      {body}
                    </Link>
                  ) : (
                    <span key={d.iso} className={`flex aspect-square flex-col items-center justify-center rounded-md ${cls}`}>
                      {body}
                    </span>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </PageFrame>
    </>
  );
}
