"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "../../../client-ui";
import { setScheduleRequestDay } from "../../../schedule-requests/actions";

const label = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// Schedule requests by Game Day (the program's Game & Bracket Days): a switch per upcoming Game Day. On, the registered
// teams' coaches can block up to 2 of the day's 4 time blocks (on their team's Games card). Directors of Programs or
// Scheduling switch them; everyone else sees which days take them.
export default function RequestDays({
  programId,
  days,
  on: initial,
  editable,
}: {
  programId: string;
  days: string[];
  on: Record<string, string>; // day → who turned it on
  editable: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  if (!days.length) return null;

  async function flip(day: string, next: boolean) {
    const before = on;
    setOn((o) => {
      const c = { ...o };
      if (next) c[day] = "you";
      else delete c[day];
      return c;
    });
    const r = await setScheduleRequestDay(programId, day, next);
    if (!r.ok) {
      setOn(before);
      return setError(r.message);
    }
    router.refresh();
  }

  return (
    <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-white/5">
      {error && <Toast key={error} message={error} />}
      <h3 className="text-sm font-semibold">Schedule requests</h3>
      <p className="text-xs text-zinc-500">
        On a day that takes them, each team&apos;s coaches can block up to 2 of 9–12, 12–3, 3–6 and 6–9 (their team&apos;s
        Games card). Closes: REC 2 weeks before the first Game Day; COMP the Sunday before the day.
      </p>
      <ul className="mt-2 divide-y divide-zinc-100 dark:divide-white/5">
        {days.map((d) => (
          <li key={d} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              {label(d)}
              {on[d] && on[d] !== "you" && <span className="block text-xs text-zinc-400">On by {on[d]}</span>}
            </span>
            {editable ? (
              <label className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">{on[d] ? "Taking requests" : "Off"}</span>
                <input
                  type="checkbox"
                  className="size-5 accent-scenic-navy"
                  checked={!!on[d]}
                  onChange={(e) => flip(d, e.target.checked)}
                />
              </label>
            ) : (
              <span className="text-xs text-zinc-500">{on[d] ? "Taking requests" : "No requests"}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
