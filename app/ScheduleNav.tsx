import Link from "next/link";
import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { hasArea } from "@/lib/org-admin";

// Schedule (Thunder): Practice and Season (Directors of Facilities, with Practice Management), Events (Directors of
// Programs, with Event Management). Admins see all three.
export async function scheduleLinks(user: SessionUser) {
  const [practice, events] = await Promise.all([hasFeature(db, "thunder", "practice"), hasFeature(db, "thunder", "events")]);
  const facilities = practice && hasArea(user, "facilities");
  const programs = events && hasArea(user, "programs");
  return [
    { key: "practice", href: "/practice", label: "Practice", show: facilities },
    { key: "season", href: "/practice/season", label: "Season", show: facilities },
    { key: "events", href: "/events", label: "Events", show: programs },
  ].filter((l) => l.show);
}

export default async function ScheduleNav({ user, current }: { user: SessionUser; current: "practice" | "season" | "events" }) {
  const links = await scheduleLinks(user);
  if (links.length < 2) return null;
  return (
    <nav aria-label="Schedule" className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
      {links.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          aria-current={current === l.key ? "page" : undefined}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${
            current === l.key
              ? "border-thunder-orange text-zinc-900 dark:text-white"
              : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
