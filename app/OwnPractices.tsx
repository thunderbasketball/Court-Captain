"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addTeamPractice, removeTeamPractice } from "./team-practices/actions";
import { Alert } from "./client-ui";
import { fieldLabel, inputCls, primaryBtn } from "./ui";

const LENGTHS = [30, 45, 60, 75, 90, 105, 120, 150, 180, 210, 240];
const lengthLabel = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} hr${r ? ` ${r} min` : ""}` : `${m} min`;
};
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

// "+ Own gym practice": opens a form right here in the Practices card (no pop-up) for a practice at a place the team
// found itself: place, date, start time and length, and "Repeat every week until …". No booking limits.
export function OwnPracticeAdd({
  org,
  teamId,
  locations,
  today,
  bare = false,
}: {
  org: string;
  teamId: string;
  locations: string[];
  today: string;
  bare?: boolean; // just the form (already opened from Book practices → Own gym)
}) {
  const router = useRouter();
  const [open, setOpen] = useState(bare);
  const [location, setLocation] = useState(locations[0] ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:00");
  const [minutes, setMinutes] = useState(60);
  const [weekly, setWeekly] = useState(false);
  const [until, setUntil] = useState("");
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [busy, start] = useTransition();
  const weekday = date ? WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()] : "week";

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await addTeamPractice(org, teamId, { location, date, time, minutes, weeklyUntil: weekly ? until : "" });
      if (!r.ok) return setMsg({ tone: "red", text: r.message });
      const n = r.added;
      setMsg({
        tone: "green",
        text: `Added ${n} practice${n === 1 ? "" : "s"}.${r.skipped ? ` ${r.skipped} week${r.skipped === 1 ? " was" : "s were"} already there.` : ""}`,
      });
      setDate("");
      setWeekly(false);
      setUntil("");
      router.refresh();
    });

  return (
    <div className={bare ? "" : "border-t border-zinc-100 px-4 py-3 dark:border-white/5"}>
      {!bare && <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`rounded-full px-3 py-1.5 text-sm font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10 ${open ? "ring-2" : ""}`}
      >
        + Own gym practice
      </button>}
      {open && (
        <div className={bare ? "space-y-3" : "mt-3 space-y-3"}>
          <p className="text-sm text-zinc-500">A place your team found itself: any day, time and length, no limits.</p>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <label className="block">
            <span className={fieldLabel}>Place</span>
            <input
              className={inputCls}
              value={location}
              maxLength={80}
              list={`own-gyms-${teamId}`}
              placeholder="e.g. Masters Gym"
              onChange={(e) => setLocation(e.target.value)}
            />
            <datalist id={`own-gyms-${teamId}`}>
              {locations.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabel}>Date</span>
              <input type="date" className={inputCls} min={today} value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="block">
              <span className={fieldLabel}>Start time</span>
              <input type="time" step={300} className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className={fieldLabel}>Length</span>
            <select className={inputCls} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {LENGTHS.map((m) => (
                <option key={m} value={m}>
                  {lengthLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="size-4" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
            Make it weekly ({weekday})
          </label>
          {weekly && (
            <label className="block">
              <span className={fieldLabel}>Every week until</span>
              <input type="date" className={inputCls} min={date || today} value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
          )}
          <button type="button" disabled={busy} onClick={save} className={primaryBtn}>
            {busy ? "Adding…" : weekly ? "Add weekly practice" : "Add practice"}
          </button>
        </div>
      )}
    </div>
  );
}

// One own-gym practice in the Practices card: day and time span, the place and length, "Weekly" when it repeats, and
// Remove (opens right here: this one, or this and later weeks).
export function OwnPracticeRow({
  org,
  teamId,
  id,
  when,
  span,
  location,
  minutes,
  weekly,
  addedBy,
  canChange,
}: {
  org: string;
  teamId: string;
  id: string;
  when: string;
  span: string;
  location: string;
  minutes: number;
  weekly: boolean;
  addedBy: string | null;
  canChange: boolean;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const remove = (later: boolean) =>
    start(async () => {
      setError(null);
      const r = await removeTeamPractice(org, teamId, id, later);
      if (!r.ok) return setError(r.message);
      setAsking(false);
      router.refresh();
    });
  return (
    <li className="px-4 py-2.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-semibold">
            {when} <span className="font-normal text-zinc-500">· {span}</span>
          </span>
          <span className="block text-xs text-zinc-500">
            Own gym · {lengthLabel(minutes)}
            {weekly && " · Weekly"}
            {addedBy && ` · by ${addedBy}`}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-right text-zinc-500">
          {location}
          {canChange && (
            <button
              type="button"
              aria-label={`Remove the ${when} practice`}
              onClick={() => setAsking((a) => !a)}
              className="rounded-full px-2 py-0.5 text-xs font-semibold text-red-600 ring-1 ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-500/40 dark:hover:bg-red-500/10"
            >
              Remove
            </button>
          )}
        </span>
      </div>
      {asking && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => remove(false)}
            className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
          >
            Remove this one
          </button>
          {weekly && (
            <button
              type="button"
              disabled={busy}
              onClick={() => remove(true)}
              className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              This and later weeks
            </button>
          )}
          <button type="button" onClick={() => setAsking(false)} className="rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-zinc-300 dark:ring-white/20">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  );
}
