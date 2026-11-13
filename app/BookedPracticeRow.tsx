"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { releaseSlot } from "./org/thunder/practice/actions";

const redBtn = "rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700";

// A booked practice on the team's Practices card: the time (to its ✓ Attendance page), the gym and court, and, for the
// team's coaches and manager (and Directors), Cancel, which asks right here: this one, or this and later weeks at the
// same court and time. The server checks who may cancel again.
export default function BookedPracticeRow({
  id,
  when,
  gym,
  bookedBy,
  canCancel,
}: {
  id: string;
  when: string;
  gym: string;
  bookedBy: string | null;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const cancel = (everyWeek: boolean) =>
    start(async () => {
      setError(null);
      const r = await releaseSlot({ slotId: id, everyWeek });
      if (!r.ok) return setError(r.message);
      setAsking(false);
      router.refresh();
    });
  return (
    <li className="px-4 py-2.5 text-sm">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/events/practice/${id}`} className="font-semibold text-thunder-blue underline-offset-2 hover:underline dark:text-blue-400">
          {when}
          <span className="block text-xs font-normal">✓ Attendance</span>
        </Link>
        <span className="flex shrink-0 items-center gap-2 text-right text-zinc-500">
          <span>
            {gym}
            {bookedBy && <span className="block text-xs text-zinc-400">by {bookedBy}</span>}
          </span>
          {canCancel && (
            <button
              type="button"
              aria-label={`Cancel the ${when} practice`}
              onClick={() => setAsking((a) => !a)}
              className="rounded-full px-2 py-0.5 text-xs font-semibold text-red-600 ring-1 ring-red-300 hover:bg-red-50 dark:text-red-400 dark:ring-red-500/40 dark:hover:bg-red-500/10"
            >
              Cancel
            </button>
          )}
        </span>
      </div>
      {asking && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => cancel(false)} className={redBtn}>
            {busy ? "Canceling…" : "Cancel this one"}
          </button>
          <button type="button" disabled={busy} onClick={() => cancel(true)} className={redBtn}>
            This and later weeks
          </button>
          <button type="button" onClick={() => setAsking(false)} className="rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-zinc-300 dark:ring-white/20">
            Keep
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  );
}
