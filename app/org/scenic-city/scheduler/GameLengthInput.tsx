"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setGameLength } from "../actions";

// This Game Day's game length (minutes), in the day's header: change it and Save. Only this date changes; the Grid's
// blocks redraw and placed games move with them.
export function GameLengthInput({
  day,
  label,
  minutes,
  setBy,
}: {
  day: string;
  label: string; // "Sat, Jan 9"
  minutes: number;
  setBy: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(minutes));
  // The saved length came back from the server: show it (keeping any note about games taken off).
  const [seen, setSeen] = useState(minutes);
  if (seen !== minutes) {
    setSeen(minutes);
    setValue(String(minutes));
  }
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const changed = value !== String(minutes);
  return (
    <form
      className="mx-4 mt-3 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-white/5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          setNote(null);
          const r = await setGameLength(day, Number(value));
          if (!r.ok) return setError(r.message);
          if (r.off.length) setNote(`No longer fit, back to be placed: ${r.off.join("; ")}.`);
          router.refresh();
        });
      }}
    >
      <div className="flex items-center gap-2">
        <label htmlFor={`len-${day}`} className="text-sm font-semibold whitespace-nowrap">
          Game length
        </label>
        <input
          id={`len-${day}`}
          type="number"
          inputMode="numeric"
          min={20}
          max={180}
          step={5}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-20 rounded-md bg-white px-2 py-1 text-base ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15"
        />
        <span className="text-sm text-zinc-500">min</span>
        <button
          type="submit"
          disabled={busy || !changed}
          className="ml-auto rounded-md bg-scenic-navy px-3 py-1 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        <span className="font-semibold text-amber-800 dark:text-amber-300">{label} only.</span> Other Game Days keep their own
        length. Placed games move with their blocks.
        {setBy && ` Set by ${setBy}.`}
      </p>
      {error && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
      {note && <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-300">{note}</p>}
    </form>
  );
}
