"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CourtDay, Use } from "@/lib/facilities";
import { timeLabel } from "@/lib/time";
import { setAvailability } from "./actions";
import { Alert, Toast } from "../client-ui";
import { inputCls, pillCls } from "../ui";
import MonthCalendar, { addMonths, monthOf, type DayLook } from "../scenic/MonthCalendar";

type Gym = { id: string; name: string; courts: string[] }; // courts: the practice goals (Goal #1, Goal #2)
const TONE: Record<Use, DayLook["tone"]> = { practice: "practice", partner: "open", "in-house": "inhouse" };
const short = (t: string) => timeLabel(t).replace(":00", "").replace(" AM", "a").replace(" PM", "p");

// Half-hour times from 6:00 AM to 11:00 PM.
const TIMES = Array.from({ length: 35 }, (_, i) => {
  const m = 6 * 60 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 ? "30" : "00"}`;
});

// One gym at a time: its use on each date (Practice Slots, a league's games, e.g. "Scenic City", In-House Games) and hours. Practice covers
// all its goals (Goal #1, Goal #2); games use the gym.
// Tap dates, pick the use, keep the default hours or set them, Save. Or clear the selected dates.
export default function FacilityCalendar({
  org,
  today,
  gyms,
  uses,
  days,
  gameDays = {},
}: {
  org?: string; // the organization (Thunder when left out)
  today: string;
  gyms: Gym[];
  uses: { key: Use; name: string }[];
  days: Record<string, CourtDay>;
  gameDays?: Record<string, string>; // date → league that plays then
}) {
  const router = useRouter();
  const [gymId, setGymId] = useState(gyms[0]?.id ?? "");
  const gym = gyms.find((g) => g.id === gymId) ?? gyms[0];
  const [picked, setPicked] = useState<string[]>([]);
  const [use, setUse] = useState<Use | "">(uses[0]?.key ?? "");
  const [defaults, setDefaults] = useState(true);
  const [starts, setStarts] = useState("18:00");
  const [ends, setEnds] = useState("21:00");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const league = uses.find((u) => u.key === "partner")?.name ?? "League";
  const SHORT: Record<Use, string> = { practice: "Practice", partner: league, "in-house": "In-House" };
  if (!gym) return <p className="text-sm text-zinc-500">No gyms yet. Add one first.</p>;

  const look = (date: string): DayLook => {
    if (picked.includes(date)) return { tappable: true, tone: "selected", note: "Selected" };
    const d = days[`${gym.id}:${date}`];
    const tappable = date >= today;
    const plays = gameDays[date];
    // A league's game day not marked yet: outlined with the league's name, so hosts see when they can offer the gym.
    if (!d) return plays ? { tappable, tone: "game", note: `${plays} games` } : { tappable, tone: "plain" };
    return { tappable, tone: TONE[d.use], note: `${SHORT[d.use]} ${short(d.starts)}–${short(d.ends)}`, dot: !!plays };
  };
  const tap = (date: string) =>
    date >= today && setPicked((p) => (p.includes(date) ? p.filter((d) => d !== date) : [...p, date]));

  const save = (clear: boolean) =>
    start(async () => {
      setError(null);
      const r = await setAvailability({
        org,
        gymId: gym.id,
        days: picked,
        use: clear ? null : use || undefined,
        defaults,
        starts,
        ends,
      });
      if (!r.ok) return setError(r.message);
      const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
      const slots = [
        r.slotsAdded && `${n(r.slotsAdded, "practice slot")} added`,
        r.slotsRemoved && `${n(r.slotsRemoved, "open slot")} removed`,
      ]
        .filter(Boolean)
        .join(", ");
      setDone(`${clear ? "Cleared" : "Saved"} ${n(picked.length, "date")}.${slots ? ` ${slots}.` : ""}`);
      setPicked([]);
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {gyms.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {gyms.map((g) => (
            <button
              key={g.id}
              type="button"
              className={pillCls(g.id === gym.id)}
              onClick={() => {
                setGymId(g.id);
                setPicked([]);
              }}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}
      {gym.courts.length > 0 && (
        <p className="text-xs text-zinc-500">
          Practice Slots here split into {gym.courts.join(" and ")}. Games use the whole gym.
        </p>
      )}
      <MonthCalendar
        today={today}
        firstMonth={monthOf(today)}
        lastMonth={addMonths(monthOf(today), 12)}
        look={look}
        onTap={tap}
      />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        {Object.keys(gameDays).length > 0 && (
          <span>
            <span className="mr-1 inline-block size-2.5 rounded-sm bg-white ring-2 ring-scenic-navy/60" />
            League game day (dot when already marked)
          </span>
        )}
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-sky-100 ring-2 ring-sky-600/50" />
          Practice Slots
        </span>
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-emerald-100 ring-2 ring-emerald-600/50" />
          {league === "League" ? "League Games" : league}
        </span>
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-amber-100 ring-2 ring-amber-600/50" />
          In-House Games
        </span>
      </p>

      {picked.length > 0 && (
        <div className="space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/50">
          <p className="text-sm font-medium">
            {picked.length} date{picked.length === 1 ? "" : "s"} selected at {gym.name}
          </p>
          <div className="flex flex-wrap gap-2">
            {uses.map((u) => (
              <button key={u.key} type="button" className={pillCls(use === u.key)} onClick={() => setUse(u.key)}>
                {u.name}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={defaults} onChange={(e) => setDefaults(e.target.checked)} />
            Default hours (Mon–Fri 6–9 PM, Sat–Sun 9 AM–9 PM)
          </label>
          {!defaults && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">
                Start
                <select className={`${inputCls} mt-1`} value={starts} onChange={(e) => setStarts(e.target.value)}>
                  {TIMES.slice(0, -1).map((t) => (
                    <option key={t} value={t}>
                      {timeLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                End
                <select className={`${inputCls} mt-1`} value={ends} onChange={(e) => setEnds(e.target.value)}>
                  {TIMES.slice(1).map((t) => (
                    <option key={t} value={t}>
                      {timeLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {error && <Alert tone="red">{error}</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || !use}
              onClick={() => save(false)}
              className="rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => save(true)}
              className="text-sm font-medium text-red-600 hover:underline"
            >
              Clear selected dates
            </button>
            <button type="button" onClick={() => setPicked([])} className="ml-auto text-sm text-zinc-500">
              Unselect
            </button>
          </div>
        </div>
      )}
      {!uses.length && <p className="text-sm text-zinc-500">Thunder has no availability options yet (see Features).</p>}
      {done && <Toast key={done} message={done} />}
    </div>
  );
}
