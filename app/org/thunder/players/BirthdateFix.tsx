"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fixBirthdateAction } from "./actions";

const show = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// On a player's opened card (Admins and Directors of Players): "Fix birthday" opens a date right here. A fixed one says so,
// with what TeamSnap says and "Use TeamSnap's". The fix stays through every sheet sync until TeamSnap says the same.
export default function BirthdateFix({
  registrantId,
  birthdate,
  fix,
}: {
  registrantId: string;
  birthdate: string | null;
  fix: { setBy: string; sheetBirthdate: string | null } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(birthdate ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const save = (d: string | null) =>
    start(async () => {
      const r = await fixBirthdateAction(registrantId, d);
      setMsg(r.ok ? null : r.message);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  return (
    <div className="space-y-1.5 text-xs">
      {fix && (
        <p className="text-amber-700 dark:text-amber-400">
          Birthday fixed in the app by {fix.setBy}. TeamSnap says {fix.sheetBirthdate ? show(fix.sheetBirthdate) : "none"}.{" "}
          <button type="button" disabled={busy} onClick={() => save(null)} className="font-medium underline">
            Use TeamSnap&apos;s
          </button>
        </p>
      )}
      <button type="button" onClick={() => setOpen(!open)} className="font-medium text-thunder-blue hover:underline dark:text-blue-400">
        {open ? "Cancel" : "Fix birthday"}
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            aria-label="Birthday"
            className="rounded-lg bg-white px-3 py-1.5 text-base ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15"
          />
          <button
            type="button"
            disabled={busy || !day || day === birthdate}
            onClick={() => save(day)}
            className="rounded-full bg-thunder-blue px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Save birthday
          </button>
        </div>
      )}
      {msg && <p className="text-red-600 dark:text-red-400">{msg}</p>}
    </div>
  );
}
