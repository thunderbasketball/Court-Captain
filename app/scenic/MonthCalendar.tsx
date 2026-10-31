"use client";

import { useState, type ReactNode } from "react";

// A month at a time, Sunday first, with ‹ › to move between months. Dates are "YYYY-MM-DD" (calendar days, no time zone).
// The caller says how each day looks and whether it can be tapped.
export type DayLook = {
  tappable: boolean;
  tone: "plain" | "game" | "open" | "selected" | "remove" | "practice" | "inhouse" | "mixed";
  note?: ReactNode;
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const TONES: Record<DayLook["tone"], string> = {
  plain: "text-zinc-400 dark:text-zinc-600",
  game: "bg-white text-scenic-navy ring-2 ring-scenic-navy/60 dark:bg-zinc-900 dark:text-white dark:ring-white/50",
  open: "bg-emerald-50 text-emerald-900 ring-2 ring-emerald-600/50 dark:bg-emerald-500/15 dark:text-emerald-200",
  selected: "bg-scenic-navy text-white ring-2 ring-scenic-navy dark:bg-white dark:text-scenic-navy dark:ring-white",
  remove: "bg-red-50 text-red-700 line-through ring-2 ring-red-500/60 dark:bg-red-500/15 dark:text-red-300",
  practice: "bg-sky-50 text-sky-900 ring-2 ring-sky-600/50 dark:bg-sky-500/15 dark:text-sky-200",
  inhouse: "bg-amber-50 text-amber-900 ring-2 ring-amber-600/50 dark:bg-amber-500/15 dark:text-amber-200",
  mixed: "bg-zinc-100 text-zinc-800 ring-2 ring-zinc-400/60 dark:bg-zinc-800 dark:text-zinc-200",
};

export default function MonthCalendar({
  today,
  firstMonth,
  lastMonth,
  look,
  onTap,
}: {
  today: string;
  firstMonth: string; // "YYYY-MM": earliest month to show
  lastMonth: string; // "YYYY-MM": latest month to show
  look: (date: string) => DayLook;
  onTap: (date: string) => void;
}) {
  const [month, setMonth] = useState(firstMonth);
  const [y, m] = month.split("-").map(Number);
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const startDay = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(startDay).fill(null), ...Array.from({ length: daysIn }, (_, i) => ymd(y, m, i + 1))];
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
  const navBtn = "rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          className={navBtn}
          aria-label="Previous month"
          disabled={month <= firstMonth}
          onClick={() => shift(-1)}
        >
          ‹
        </button>
        <h3 className="font-semibold">{title}</h3>
        <button type="button" className={navBtn} aria-label="Next month" disabled={month >= lastMonth} onClick={() => shift(1)}>
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-zinc-500">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <span key={i} />;
          const l = look(date);
          return (
            <button
              key={date}
              type="button"
              disabled={!l.tappable}
              aria-pressed={l.tone === "selected" || l.tone === "remove"}
              aria-label={date}
              onClick={() => onTap(date)}
              className={`flex min-h-12 flex-col items-center justify-start rounded-lg pt-1 text-sm tabular-nums transition-colors ${TONES[l.tone]} ${
                date === today ? "font-bold underline" : ""
              } ${l.tappable ? "cursor-pointer" : "cursor-default"}`}
            >
              {Number(date.slice(8))}
              {l.note && <span className="mt-0.5 text-[9px] leading-tight font-medium no-underline">{l.note}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// "2026-12-05" → "2026-12"
export const monthOf = (date: string) => date.slice(0, 7);
// A month n months after "YYYY-MM".
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
