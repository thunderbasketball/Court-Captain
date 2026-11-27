"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RULES_NOTE, hourLabel } from "@/lib/schedule-request-blocks";
import type { RequestDay } from "@/lib/schedule-requests";
import { Toast } from "./client-ui";
import SubCard from "./SubCard";
import { saveLeagueHourBlock, saveScheduleRequest, setScheduleSitOut } from "./schedule-requests/actions";

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const short = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Schedule (top of a team's Games card; its Head and Assistant Coaches and the Scheduler): every upcoming date the team
// plays in its League, then the Brackets. Each date has Sit out; Game Days that take requests also have the League's time
// blocks, up to its limit checked as times the team can't play. The Brackets take no time requests. Each tap saves at once; every
// rule is checked again on the server.
export default function ScheduleRequests({ teamId, days: initial }: { teamId: string; days: RequestDay[] }) {
  const router = useRouter();
  const [days, setDays] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const anyRequests = days.some((d) => d.requests);
  const limit = days.find((d) => d.requests)?.max ?? 2; // the League's limit (each row checks its own)
  const open = days.filter((d) => d.requests && d.open && !d.off).length;
  const same = (d: RequestDay) => (x: RequestDay) => x.programId === d.programId && x.day === d.day;

  async function toggle(d: RequestDay, key: string) {
    const blocks = d.blocks.includes(key) ? d.blocks.filter((b) => b !== key) : [...d.blocks, key];
    if (blocks.length > d.max)
      return setError(`Check up to ${d.max} of the ${d.options.length} times; the team must be free for the others.`);
    setDays((list) => list.map((x) => (same(d)(x) ? { ...x, blocks } : x)));
    const r = await saveScheduleRequest(teamId, d.programId, d.day, blocks);
    if (!r.ok) {
      setDays((list) => list.map((x) => (same(d)(x) ? { ...x, blocks: d.blocks } : x)));
      return setError(r.message);
    }
    setDays((list) => list.map((x) => (same(d)(x) ? { ...x, setBy: blocks.length ? r.setBy : null } : x)));
    router.refresh();
  }

  // The League's own blocks (its staff only): tap an hour to block or free it; saved at once.
  async function toggleHour(d: RequestDay, h: number) {
    if (!d.league) return;
    const was = d.league;
    const hours = was.hours.includes(h) ? was.hours.filter((x) => x !== h) : [...was.hours, h].sort((a, b) => a - b);
    setDays((list) => list.map((x) => (same(d)(x) ? { ...x, league: { ...was, hours } } : x)));
    const r = await saveLeagueHourBlock(teamId, d.programId, d.day, hours);
    if (!r.ok) {
      setDays((list) => list.map((x) => (same(d)(x) ? { ...x, league: was } : x)));
      return setError(r.message);
    }
    setDays((list) => list.map((x) => (same(d)(x) ? { ...x, league: { ...was, hours, setBy: hours.length ? r.setBy : null } } : x)));
    router.refresh();
  }

  async function sitOut(d: RequestDay, out: boolean) {
    setBusy(true);
    const r = await setScheduleSitOut(teamId, d.programId, d.day, out);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setDays((list) => list.map((x) => (same(d)(x) ? { ...x, off: out ? "team" : null, offBy: null } : x)));
    router.refresh();
  }

  return (
    <SubCard title="Schedule requests" count={open ? `${open} open` : `${days.length} date${days.length === 1 ? "" : "s"}`}>
      {error && <Toast key={error} message={error} />}
      <div className="space-y-3 px-4 py-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {anyRequests && (
            <>
              Check up to {limit} time{limit === 1 ? "" : "s"} the team <span className="font-semibold">can&apos;t</span> play; it must be
              available for the others.{" "}
            </>
          )}
          Check <span className="font-semibold">Sit out</span> if the team won&apos;t play that week. No time requests during
          the Brackets.
        </p>
        {anyRequests && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/10 dark:text-amber-300">
            {RULES_NOTE}
          </p>
        )}
        <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
          {days.map((d) => {
            const bracket = d.day === "brackets";
            const out = !!d.off;
            const many = days.some((x) => x.programId !== d.programId);
            return (
              <li key={`${d.programId}-${d.day}`} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className={`text-sm font-semibold ${out ? "text-zinc-400 line-through" : ""}`}>
                    {bracket ? "Brackets" : day(d.day)}
                    <span className="ml-1 font-normal text-zinc-500">
                      {bracket
                        ? d.bracketDays.length
                          ? `· ${d.bracketDays.map(short).join(", ")}`
                          : "· dates TBD"
                        : d.games && `· ${d.games} game${d.games === 1 ? "" : "s"}`}
                      {many && ` · ${d.program}`}
                    </span>
                  </span>
                  <label
                    className={`flex items-center gap-1.5 text-sm ${out ? "font-medium text-red-700 dark:text-red-400" : ""} ${
                      d.off === "league" ? "opacity-60" : "cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-red-600"
                      checked={out}
                      disabled={busy || d.off === "league"}
                      onChange={() => sitOut(d, !out)}
                    />
                    {d.off === "league" ? "Taken out by the League" : "Sit out"}
                  </label>
                </div>
                {d.requests && !out && (
                  <>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {d.options.map((b) => {
                        const off = d.blocks.includes(b.key);
                        return (
                          <label
                            key={b.key}
                            className={`flex items-center gap-1.5 py-0.5 text-sm ${off ? "font-medium text-red-700 dark:text-red-400" : ""} ${
                              d.open ? "cursor-pointer" : "opacity-60"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="size-4 accent-red-600"
                              checked={off}
                              disabled={!d.open}
                              onChange={() => toggle(d, b.key)}
                            />
                            {b.label}
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-xs text-zinc-400">
                      {d.open ? `Requests close ${day(d.closes)} night` : "Requests closed"}
                      {d.blocks.length > 0 && ` · can't play checked times · ${d.setBy}`}
                    </p>
                  </>
                )}
                {!d.requests && !bracket && !out && <p className="text-xs text-zinc-400">No time requests this day</p>}
                {d.league && !out && d.league.options.length > 0 && (
                  <div className="mt-2 rounded-lg bg-violet-50 px-2.5 py-2 ring-1 ring-violet-600/20 ring-inset dark:bg-violet-500/10">
                    <p className="text-xs font-semibold text-violet-800 dark:text-violet-300">
                      League blocks <span className="font-normal">· only League staff see these · tap the hours the team can&apos;t play</span>
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {d.league.options.map((h) => {
                        const on = d.league!.hours.includes(h);
                        return (
                          <button
                            key={h}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleHour(d, h)}
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ring-1 ${
                              on ? "bg-red-600 text-white ring-red-600" : "bg-white text-zinc-700 ring-zinc-300 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/20"
                            }`}
                          >
                            {hourLabel(h)}
                          </button>
                        );
                      })}
                    </div>
                    {d.league.hours.length > 0 && <p className="mt-1 text-xs text-zinc-500">Blocked by {d.league.setBy}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </SubCard>
  );
}
