"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HoursWindow } from "@/lib/scenic-partners";
import { timeLabel } from "@/lib/time";
import { setHours } from "../../actions";
import { Alert, Toast, useConfirm } from "../../../../client-ui";
import { fieldLabel, inputCls, pillCls, primaryBtn } from "../../../../ui";
import MonthCalendar, { monthOf, type DayLook } from "../../MonthCalendar";

type Court = { id: string; gym: string; name: string };
type Day = { id: string; day: string };

// Every half hour from 9:00 AM to 10:00 PM (the only times courts can be offered).
const TIMES = Array.from({ length: 27 }, (_, i) => `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
// "21:00" → "9p", "13:30" → "1:30p"
const short = (t: string) => timeLabel(t).replace(":00", "").replace(" AM", "a").replace(" PM", "p");

// Tap game days on the calendar, pick a start and end time, Submit. Days already set show their hours.
// Not `editable` (anyone but the partner's contacts): the calendar only shows the hours.
export default function GymAvailability({
  partnerId,
  today,
  courts,
  days,
  hours,
  editable,
}: {
  partnerId: string;
  today: string;
  courts: Court[];
  days: Day[];
  hours: Record<string, HoursWindow>;
  editable: boolean;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState(courts.map((c) => c.id));
  const [selected, setSelected] = useState<string[]>([]); // game day ids
  const [starts, setStarts] = useState("09:00");
  const [ends, setEnds] = useState("21:00");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();

  const byDate = new Map(days.map((d) => [d.day, d]));
  const windows = (dayId: string) => picked.map((c) => hours[`${c}:${dayId}`]).filter(Boolean);
  const look = (date: string): DayLook => {
    const d = byDate.get(date);
    if (!d) return { tappable: false, tone: "plain" };
    if (!editable) {
      const w = windows(d.id);
      if (!w.length) return { tappable: false, tone: "game", note: "Game day" };
      const same = w.every((x) => x.starts === w[0].starts && x.ends === w[0].ends);
      return {
        tappable: false,
        tone: "open",
        note: same && w.length === picked.length ? `${short(w[0].starts)}–${short(w[0].ends)}` : `${w.length} open`,
      };
    }
    if (selected.includes(d.id)) return { tappable: true, tone: "selected", note: "✓" };
    const w = windows(d.id);
    if (!w.length) return { tappable: true, tone: "game", note: "Game day" };
    const same = w.every((x) => x.starts === w[0].starts && x.ends === w[0].ends);
    return {
      tappable: true,
      tone: "open",
      note: same && w.length === picked.length ? `${short(w[0].starts)}–${short(w[0].ends)}` : `${w.length} open`,
    };
  };
  const tap = (date: string) => {
    const d = byDate.get(date);
    if (d && editable) setSelected(selected.includes(d.id) ? selected.filter((x) => x !== d.id) : [...selected, d.id]);
  };

  const send = (clear: boolean) =>
    start(async () => {
      setError(null);
      const r = await setHours(partnerId, {
        courtIds: picked,
        dayIds: selected,
        starts: clear ? null : starts,
        ends: clear ? null : ends,
      });
      if (!r.ok) return setError(r.message);
      setSelected([]);
      setDone(clear ? "Hours deleted." : `Saved: ${timeLabel(starts)}–${timeLabel(ends)}.`);
      router.refresh();
    });

  if (!days.length) return <p className="text-zinc-500">No upcoming game days yet. Scenic City will add them.</p>;
  const first = monthOf(days[0].day) < monthOf(today) ? monthOf(today) : monthOf(days[0].day);
  const last = monthOf(days.at(-1)!.day);

  return (
    <div className="space-y-4">
      {courts.length > 1 && (
        <div>
          <span className={fieldLabel}>Courts</span>
          <div className="flex flex-wrap gap-2">
            {courts.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={picked.includes(c.id)}
                className={pillCls(picked.includes(c.id))}
                onClick={() => setPicked(picked.includes(c.id) ? picked.filter((x) => x !== c.id) : [...picked, c.id])}
              >
                {courts.some((x) => x.gym !== c.gym) ? `${c.gym} · ${c.name}` : c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <MonthCalendar today={today} firstMonth={first} lastMonth={last < first ? first : last} look={look} onTap={tap} />
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm ring-2 ring-scenic-navy/60" />
          Game day
        </span>
        <span>
          <span className="mr-1 inline-block size-2.5 rounded-sm bg-emerald-100 ring-2 ring-emerald-600/50" />
          Hours set
        </span>
        {editable && (
          <span>
            <span className="mr-1 inline-block size-2.5 rounded-sm bg-scenic-navy" />
            Selected
          </span>
        )}
      </p>

      {editable && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabel}>Start</span>
              <select className={inputCls} value={starts} onChange={(e) => setStarts(e.target.value)}>
                {TIMES.slice(0, -1).map((t) => (
                  <option key={t} value={t}>
                    {timeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>End</span>
              <select className={inputCls} value={ends} onChange={(e) => setEnds(e.target.value)}>
                {TIMES.slice(1).map((t) => (
                  <option key={t} value={t} disabled={t <= starts}>
                    {timeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <Alert tone="red">{error}</Alert>}
          <button
            type="button"
            className={primaryBtn}
            disabled={busy || !selected.length || !picked.length || ends <= starts}
            onClick={() => send(false)}
          >
            {busy
              ? "Saving…"
              : selected.length
                ? `Submit ${selected.length} ${selected.length === 1 ? "day" : "days"}`
                : "Tap game days above"}
          </button>
          {selected.length > 0 && (
            <button
              type="button"
              disabled={busy}
              className="w-full rounded-xl px-4 py-2 text-sm font-medium text-red-600 ring-1 ring-red-600/20 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              onClick={async () => {
                if (
                  await confirm({
                    title: "Delete hours?",
                    message: `Removes the hours on the ${selected.length} selected day(s).`,
                    confirmLabel: "Delete",
                  })
                )
                  send(true);
              }}
            >
              Delete hours on selected days
            </button>
          )}
        </>
      )}
      {done && <Toast key={done} message={done} />}
      {confirmDialog}
    </div>
  );
}
