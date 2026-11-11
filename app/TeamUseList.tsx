"use client";

import { useState } from "react";
import Link from "next/link";
import { TZ } from "@/lib/time";

type TeamUse = { id: string; name: string; views: number; lastVisit: Date | string | null };

// To Do → Teams not using the app: every team with its staff's page views in the last 30 days and their last visit,
// least used first; ⇅ turns it around (most used first).
export default function TeamUseList({ teams, base }: { teams: TeamUse[]; base: string }) {
  const [most, setMost] = useState(false);
  const list = most ? [...teams].reverse() : teams;
  const last = (d: TeamUse["lastVisit"]) =>
    d ? new Date(d).toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" }) : "Never";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span>Page views by each team&apos;s staff, last 30 days · {most ? "most" : "least"} used first</span>
        <button
          type="button"
          onClick={() => setMost(!most)}
          aria-label={most ? "Show least used first" : "Show most used first"}
          title={most ? "Least used first" : "Most used first"}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
        >
          ⇅
        </button>
      </div>
      <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto dark:divide-white/5">
        {list.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <Link href={`${base}/teams/${t.id}`} className="min-w-0 truncate text-thunder-blue hover:underline">
              {t.name}
            </Link>
            <span className="shrink-0 text-right text-xs tabular-nums">
              <span className={t.views ? "text-zinc-700 dark:text-zinc-200" : "font-semibold text-red-600 dark:text-red-400"}>
                {t.views} view{t.views === 1 ? "" : "s"}
              </span>
              <span className="text-zinc-500"> · last {last(t.lastVisit)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
