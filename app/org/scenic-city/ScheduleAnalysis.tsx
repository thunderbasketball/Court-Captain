// Scenic City Home → Schedule analysis (Admins and Directors of Scheduling): a card per upcoming Game Day, collapsed to
// its key numbers; open it for what the numbers say and each organization's teams and game slots.
import Link from "next/link";
import type { DayAnalysis } from "@/lib/scenic-analysis";
import { card } from "../../ui";

const date = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const TONE = {
  red: "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200",
  amber: "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
  green: "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200",
};
const ICON = { red: "⚠", amber: "•", green: "✓" };

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-2.5 py-2 dark:bg-white/5">
      <p className="text-lg leading-tight font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-zinc-500">{label}</p>
      {sub && <p className="text-[11px] text-zinc-400">{sub}</p>}
    </div>
  );
}

export function ScheduleAnalysis({ days }: { days: DayAnalysis[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-1 font-semibold">Schedule analysis</h2>
      <p className="mb-3 text-xs text-zinc-500">
        Each upcoming Game Day: teams and game slots by organization, and what needs attention. Slots are court × game blocks from
        hosting sites&apos; hours.
      </p>
      {!days.length && <p className={`${card} px-4 py-3 text-sm text-zinc-500`}>No upcoming Game Days.</p>}
      <div className="space-y-3">
        {days.map((d) => {
          const red = d.notes.filter((n) => n.tone === "red").length;
          const amber = d.notes.filter((n) => n.tone === "amber").length;
          return (
            <details key={d.date} className={`${card} group overflow-hidden`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-semibold">
                    <span aria-hidden className="mr-1 inline-block text-zinc-400 transition-transform [details[open]>summary_&]:rotate-90">
                      ▸
                    </span>
                    {d.brackets
                      ? `Postseason · ${date(d.date)}${d.lastDate !== d.date ? ` – ${date(d.lastDate)}` : ""}`
                      : date(d.date)}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {d.brackets
                      ? `${d.label} · ${d.teams} teams · ${d.slots} slots`
                      : `${d.teams} teams · ${d.games} games · ${d.slots} slots · ${d.placed}/${d.games} placed`}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1 text-xs font-semibold">
                  {red > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-white">{red}</span>}
                  {amber > 0 && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-white">{amber}</span>}
                  {!red && !amber && !d.brackets && (
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-white">OK</span>
                  )}
                </span>
              </summary>
              <div className="space-y-3 border-t border-zinc-100 px-4 py-3 dark:border-white/5">
                {d.brackets && (
                  <div className="grid grid-cols-3 gap-2">
                    <Stat label="Teams" value={d.teams} />
                    <Stat label="Bracket Days" value={d.bracketDays.length} sub={d.bracketDays.map(date).join(", ")} />
                    <Stat label="Game slots" value={d.slots} sub={d.minutes ? `${d.minutes} min games` : undefined} />
                  </div>
                )}
                {!d.brackets && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    <Stat label="Teams" value={d.teams} />
                    <Stat label="Games guaranteed" value={d.gamesGuaranteed} sub="team-games" />
                    <Stat label="Matchups" value={d.games} sub={d.tbd ? `${d.tbd} TBD` : undefined} />
                    <Stat label="Game slots" value={d.slots} sub={`${d.minutes} min games`} />
                    <Stat label="Placed" value={`${d.placed}/${d.games}`} />
                    <Stat label="Slots left" value={Math.max(d.slots - d.placed, 0)} />
                  </div>
                )}
                {d.notes.length > 0 && (
                  <ul className="space-y-1">
                    {d.notes.map((n, i) => (
                      <li key={i} className={`rounded-lg px-3 py-1.5 text-sm ${TONE[n.tone]}`}>
                        <span aria-hidden className="mr-1">
                          {ICON[n.tone]}
                        </span>
                        {n.text}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Teams and game slots by organization</caption>
                    <thead className="text-xs text-zinc-500">
                      <tr>
                        <th className="py-1 pr-2 font-medium">Organization</th>
                        <th className="px-2 py-1 text-right font-medium">Teams</th>
                        <th className="px-2 py-1 text-right font-medium">Home</th>
                        <th className="px-2 py-1 text-right font-medium">Slots</th>
                        <th className="py-1 pl-2 text-right font-medium">Used</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                      {d.orgs.map((o) => (
                        <tr key={o.key} className="align-top">
                          <td className="py-1.5 pr-2">
                            <span className="font-medium">{o.name}</span>
                            <span className="block text-xs text-zinc-500">
                              {[o.comp && `${o.comp} COMP`, o.rec && `${o.rec} REC`, o.coed && `${o.coed} Pre-K`]
                                .filter(Boolean)
                                .join(" · ") || "No teams playing"}
                              {o.gyms > 0 &&
                                ` · ${o.gyms} gym${o.gyms === 1 ? "" : "s"}, ${o.courts} court${o.courts === 1 ? "" : "s"}`}
                              {o.hours && ` · ${o.hours}`}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{o.teams}</td>
                          <td
                            className={`px-2 py-1.5 text-right tabular-nums ${o.home > o.slots ? "font-semibold text-amber-700 dark:text-amber-300" : ""}`}
                          >
                            {o.home}
                            <span className="block text-xs text-zinc-400">{o.away} away</span>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{o.slots || "—"}</td>
                          <td className="py-1.5 pl-2 text-right tabular-nums">{o.slots ? o.used : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Link
                  href={`/org/scenic-city/scheduler?day=${d.date}`}
                  className="inline-block text-sm font-medium text-scenic-navy hover:underline dark:text-white"
                >
                  Open this Game Day in the Scheduler →
                </Link>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
