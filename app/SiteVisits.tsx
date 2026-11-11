"use client";

import { useState } from "react";
import type { VisitStats } from "@/lib/site-visits";
import { VISIT_RANGES, type VisitRange } from "@/lib/visit-ranges";
import BarChart from "./BarChart";
import { card } from "./ui";

// Home metrics: site visits (page views) and different people, for Today (per hour), This Week, This Month (per day)
// and This Year (per month). Times are Eastern; `start` is wall-clock ("2026-11-03T14:00").
const at = (start: string) => new Date(`${start}:00Z`);
const fmt = (start: string, opts: Intl.DateTimeFormatOptions) => at(start).toLocaleString("en-US", { timeZone: "UTC", ...opts });
const BUCKET: Record<VisitRange, Intl.DateTimeFormatOptions> = {
  today: { hour: "numeric" },
  week: { weekday: "short", month: "short", day: "numeric" },
  month: { weekday: "short", month: "short", day: "numeric" },
  year: { month: "long" },
};
const TICK: Record<VisitRange, Intl.DateTimeFormatOptions> = {
  today: { hour: "numeric" },
  week: { weekday: "short" },
  month: { month: "short", day: "numeric" },
  year: { month: "short" },
};

export default function SiteVisits({ stats, bare = false }: { stats: Record<VisitRange, VisitStats>; bare?: boolean }) {
  const [range, setRange] = useState<VisitRange>("today");
  const s = stats[range];
  const per = range === "today" ? "hour" : range === "year" ? "month" : "day";
  const views = (n: number) => `${n} visit${n === 1 ? "" : "s"}`;
  return (
    <div className={bare ? "" : `${card} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          {!bare && <h2 className="text-sm font-semibold">Site visits</h2>}
          <p className="text-xs text-zinc-500">Page views on the website, per {per} (Eastern time); coaches&apos; in green</p>
        </div>
        <div role="tablist" aria-label="Time range" className="flex rounded-full bg-zinc-100 p-0.5 text-xs dark:bg-white/10">
          {VISIT_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={range === r.key}
              onClick={() => setRange(r.key)}
              className={`rounded-full px-2.5 py-1 font-medium whitespace-nowrap ${
                range === r.key
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 mb-3 flex gap-6">
        <p>
          <span className="block text-2xl font-semibold tabular-nums">{s.views}</span>
          <span className="text-xs text-zinc-500">Visits</span>
        </p>
        <p>
          <span className="block text-2xl font-semibold tabular-nums">{s.people}</span>
          <span className="text-xs text-zinc-500">Different people</span>
        </p>
      </div>
      <BarChart
        key={range}
        bars={s.buckets.map((b) => ({
          key: b.start,
          n: b.n,
          m: b.coach,
          label: `${fmt(b.start, BUCKET[range])}: ${views(b.n)}, ${b.coach} by coaches`,
        }))}
        legend={["All visits", "Coaches"]}
        summary={`${views(s.views)} ${VISIT_RANGES.find((r) => r.key === range)!.label.toLowerCase()}`}
        first={fmt(s.buckets[0].start, TICK[range])}
        last={fmt(s.buckets.at(-1)!.start, TICK[range])}
        ariaLabel={`Site visits per ${per}`}
      />
    </div>
  );
}
