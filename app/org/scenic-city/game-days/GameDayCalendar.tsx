"use client";

import MonthCalendar, { monthOf, type DayLook } from "../MonthCalendar";

// Scenic City's game days on a calendar, view only: they come from each program's Game & Bracket Days.
// `openCourts`: for Directors of Facilities, how many hosting sites' courts are open each game day.
export default function GameDayCalendar({
  today,
  days,
  openCourts,
}: {
  today: string;
  days: string[];
  openCourts: Record<string, number>;
}) {
  const isGame = new Set(days);
  const look = (date: string): DayLook => {
    const n = openCourts[date];
    if (!isGame.has(date)) return { tappable: false, tone: "plain" };
    return { tappable: false, tone: n ? "open" : "game", note: n ? `${n} ${n === 1 ? "court" : "courts"}` : "Game day" };
  };
  const first = monthOf(today);
  const lastDay = days.at(-1);
  const last = lastDay && monthOf(lastDay) > first ? monthOf(lastDay) : first;

  return (
    <div className="space-y-4">
      <MonthCalendar today={today} firstMonth={first} lastMonth={last} look={look} onTap={() => {}} />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm ring-2 ring-scenic-navy/60" />
          Game day
        </span>
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-emerald-100 ring-2 ring-emerald-600/50" />
          Courts open
        </span>
      </p>
    </div>
  );
}
