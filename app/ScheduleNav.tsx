import Link from "next/link";
import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { hasArea } from "@/lib/org-admin";

// Schedule (Thunder): Practice and Season (Directors of Facilities, with Practice Management), Events (Directors of
// Programs, with Event Management). Admins see all three.
export async function scheduleLinks(user: SessionUser) {
  // Events moved into Programs (Home → Programs → a program's Sessions).
  const practice = await hasFeature(db, "thunder", "practice");
  const facilities = practice && hasArea(user, "practices");
  return [
    { key: "practice", href: "/org/thunder/practice", label: "Practice", show: facilities },
    { key: "season", href: "/org/thunder/practice/season", label: "Court Availability", show: facilities },
  ].filter((l) => l.show);
}

export default async function ScheduleNav({ user, current }: { user: SessionUser; current: "practice" | "season" }) {
  const links = await scheduleLinks(user);
  if (links.length < 2) return null;
  return (
    <nav aria-label="Schedule" className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-white/10">
      {links.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          aria-current={current === l.key ? "page" : undefined}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${
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
