"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAX_BLOCKS, hhmm, type RequestSettings } from "@/lib/schedule-request-blocks";
import { saveScheduleRequestSettings } from "../../../schedule-requests/actions";

type Row = { id: number; start: string; end: string };
const field =
  "w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm tabular-nums dark:border-white/15 dark:bg-zinc-900";

// The League's schedule request settings (its Schedule requests gear; Directors of Programs or Scheduling), opened in
// place: each time block's start and end (× removes it, + Add block), how many a team can check, and when requests close
// (COMP: days before each Game Day; REC: days before the first; blank: the standard rule). Checked again on
// the server; who saved it is recorded.
export default function RequestSettingsForm({ programId, settings, close }: { programId: string; settings: RequestSettings; close: (saved?: boolean) => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(settings.blocks.map((b, i) => ({ id: i, start: hhmm(b.start), end: hhmm(b.end) })));
  const [max, setMax] = useState(settings.max);
  // When requests close (blank: the standard rule).
  const [compDays, setCompDays] = useState(settings.compDays === null ? "" : String(settings.compDays));
  const [recDays, setRecDays] = useState(settings.recDays === null ? "" : String(settings.recDays));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (id: number, change: Partial<Row>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...change } : x)));
  const limit = Math.max(1, rows.length - 1);

  return (
    <form
      className="mt-2 space-y-3 rounded-xl bg-zinc-50 p-3 dark:bg-white/5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await saveScheduleRequestSettings(programId, {
            blocks: rows.map(({ start, end }) => ({ start, end })),
            max,
            compDays: compDays.trim(),
            recDays: recDays.trim(),
          });
          if (!r.ok) return setError(r.message);
          close(true);
          router.refresh();
        });
      }}
    >
      <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Time blocks</p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <input type="time" step={300} aria-label="Starts" className={field} value={r.start} onChange={(e) => set(r.id, { start: e.target.value })} />
            <span className="text-zinc-400">–</span>
            <input type="time" step={300} aria-label="Ends" className={field} value={r.end} onChange={(e) => set(r.id, { end: e.target.value })} />
            <button
              type="button"
              aria-label="Remove block"
              disabled={rows.length <= 2}
              onClick={() => {
                setRows((x) => x.filter((y) => y.id !== r.id));
                setMax((m) => Math.min(m, rows.length - 2 || 1));
              }}
              className="shrink-0 rounded-full px-2 py-1 text-lg leading-none text-zinc-500 hover:text-red-600 disabled:opacity-30"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {rows.length < MAX_BLOCKS && (
        <button
          type="button"
          onClick={() => {
            const last = rows.at(-1);
            setRows([...rows, { id: Math.max(0, ...rows.map((x) => x.id)) + 1, start: last?.end ?? "09:00", end: "" }]);
          }}
          className="text-sm font-medium text-thunder-blue dark:text-blue-400"
        >
          + Add block
        </button>
      )}
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Teams can check up to
        <select value={max} onChange={(e) => setMax(Number(e.target.value))} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 dark:border-white/15 dark:bg-zinc-900">
          {Array.from({ length: limit }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-zinc-500">of {rows.length} (they must be free for the rest)</span>
      </label>
      <p className="pt-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Requests close</p>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="w-12 font-medium">COMP</span>
        <input
          inputMode="numeric"
          aria-label="COMP: days before each Game Day"
          placeholder="Sun"
          className={`${field} w-16 text-center`}
          value={compDays}
          onChange={(e) => setCompDays(e.target.value.replace(/\D/g, "").slice(0, 2))}
        />
        <span className="text-zinc-500">days before each Game Day {compDays ? "" : "(blank: the Sunday before)"}</span>
      </label>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="w-12 font-medium">REC</span>
        <input
          inputMode="numeric"
          aria-label="REC: days before the first Game Day"
          placeholder="14"
          className={`${field} w-16 text-center`}
          value={recDays}
          onChange={(e) => setRecDays(e.target.value.replace(/\D/g, "").slice(0, 2))}
        />
        <span className="text-zinc-500">days before the League&apos;s first Game Day (all dates at once)</span>
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-full bg-thunder-blue px-3.5 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => close()}
          className="rounded-full px-3.5 py-1.5 text-sm font-medium text-zinc-600 ring-1 ring-zinc-950/10 dark:text-zinc-300 dark:ring-white/15"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Applies to every Game Day of this League. A block you remove no longer counts in requests already made.
        {settings.setBy && ` Last set by ${settings.setBy}.`}
      </p>
    </form>
  );
}
