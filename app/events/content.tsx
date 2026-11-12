import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { currentContexts } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { listEvents } from "@/lib/events";
import { listPractices } from "@/lib/practice-attendance";
import { localParts, zonedTime } from "@/lib/time";
import AppHeader from "../AppHeader";
import { PageTitle, card } from "../ui";
import { eventWhen } from "./format";
import { hasArea } from "@/lib/org-admin";

import { PageFrame } from "../ui";
import { hasFeature } from "@/lib/features";

// One row on the list: an event, or a team's booked practice.
type Item = {
  key: string;
  href: string;
  name: string;
  startsAt: Date;
  where: string | null;
  total: number;
  here: number;
  absent: number;
  note: string | null;
  practice: boolean;
};

export async function EventsContent({
  searchParams = Promise.resolve({}),
  embedded = false,
}: {
  searchParams?: PageProps<"/events">["searchParams"];
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "thunder", "events"))) return null;
  } else await requireFeature("thunder", "events");
  const deps = { pool: db, now: () => new Date() };
  const showPractices = (await searchParams).practices !== "off";
  const [events, practices, { active }] = await Promise.all([listEvents(deps, user), listPractices(deps, user), currentContexts(user)]);
  if (!hasArea(user, "events") && !events.length && !practices.length) {
    if (embedded) return null;
    redirect("/");
  }

  const items: Item[] = [
    ...events.map((e) => ({
      key: `e${e.id}`,
      href: `/events/${e.id}`,
      name: e.name,
      startsAt: e.startsAt,
      where: e.location,
      total: e.total,
      here: e.here,
      absent: e.absent,
      note: e.staff.length ? `Check-in: ${e.staff.join(", ")}` : null,
      practice: false,
    })),
    ...(showPractices ? practices : []).map((p) => ({
      key: `p${p.slotId}`,
      href: `/events/practice/${p.slotId}`,
      name: `Practice – ${p.teamName}`,
      startsAt: p.startsAt,
      where: `${p.gym} ${p.court}`,
      total: p.total,
      here: p.here,
      absent: p.absent,
      note: p.total ? null : "No roster yet",
      practice: true,
    })),
  ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.name.localeCompare(b.name));

  // Today's and later first (soonest first); earlier ones below, newest first.
  const t = localParts(new Date());
  const today = zonedTime(t.year, t.month, t.day);
  const upcoming = items.filter((e) => e.startsAt >= today);
  const past = items.filter((e) => e.startsAt < today).reverse();

  return (
    <>
      {!embedded && <AppHeader user={user} tab="schedule" context={user.isDirector ? "director" : active?.org === "thunder" ? active.key : undefined} />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <PageTitle
            title="Events"
            subtitle={
              hasArea(user, "events") ? "Events and team practices with player check-in" : "Your team practices and the events you run check-in for"
            }
          />
          {hasArea(user, "events") && (
            <Link
              href="/events/new"
              className="shrink-0 rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-thunder-blue-dark"
            >
              + New event
            </Link>
          )}
        </div>
        <Link
          href={showPractices ? "/events?practices=off" : "/events"}
          role="switch"
          aria-checked={showPractices}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          <span
            className={`flex size-5 items-center justify-center rounded-md text-xs font-bold text-white ring-1 ${
              showPractices ? "bg-thunder-blue ring-thunder-blue" : "bg-white ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-600"
            }`}
          >
            {showPractices && "✓"}
          </span>
          Show practices ({practices.length})
        </Link>
        {!items.length && <p className="text-zinc-500">Nothing here yet.{hasArea(user, "events") && " Tap “+ New event” to create one."}</p>}
        <div className="space-y-3">
          {upcoming.map((e) => (
            <ItemCard key={e.key} e={e} />
          ))}
        </div>
        {past.length > 0 && (
          <details className="mt-6">
            <summary className="cursor-pointer font-semibold text-zinc-500">Past ({past.length})</summary>
            <div className="mt-3 space-y-3">
              {past.map((e) => (
                <ItemCard key={e.key} e={e} />
              ))}
            </div>
          </details>
        )}
      </PageFrame>
    </>
  );
}

function ItemCard({ e }: { e: Item }) {
  const unknown = e.total - e.here - e.absent;
  return (
    <Link
      href={e.href}
      className={`${card} block p-4 hover:bg-zinc-50 dark:hover:bg-white/5 ${e.practice ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-thunder-blue"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold">{e.name}</h2>
        <span className="shrink-0 text-sm font-medium tabular-nums">
          <span className="text-emerald-600">✓ {e.here}</span> · <span className="text-red-600">✗ {e.absent}</span> ·{" "}
          <span className="text-zinc-500">? {unknown}</span>
        </span>
      </div>
      <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
        {eventWhen(e.startsAt)}
        {e.where && ` · ${e.where}`} · {e.total} players
      </p>
      {e.note && <p className="mt-0.5 text-xs text-zinc-400">{e.note}</p>}
    </Link>
  );
}
