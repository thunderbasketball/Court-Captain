"use client";

// One court on Facilities → Courts: its name, the divisions allowed there (or All divisions), and check boxes to change
// them. Save sends the list to the server, which checks it again.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CourtRow, DivisionOption } from "@/lib/scenic-courts";
import { setCourtDivisions } from "../actions";
import { Alert } from "../../../client-ui";

export function CourtDivisions({ court, divisions }: { court: CourtRow; divisions: DivisionOption[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(court.divisions);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const label = new Map(divisions.map((d) => [d.id, d]));
  const programs = [...new Set(divisions.map((d) => d.program))];
  const name = (id: string) => {
    const d = label.get(id);
    return d ? (programs.length > 1 ? `${d.label} (${d.program})` : d.label) : "";
  };
  const dirty = [...picked].sort().join() !== [...court.divisions].sort().join();

  const save = () =>
    start(async () => {
      setError(null);
      const r = await setCourtDivisions(court.key, picked);
      if (!r.ok) return setError(r.message);
      setEditing(false);
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{court.name}</p>
          <p className="text-xs text-zinc-500">
            {court.divisions.length ? (
              <>
                Only {court.divisions.map(name).join(", ")}
                {court.setBy && <span className="block text-zinc-400">Set by {court.setBy}</span>}
              </>
            ) : (
              "All divisions"
            )}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold text-scenic-navy ring-1 ring-scenic-navy/30 dark:text-white dark:ring-white/30"
          >
            Change
          </button>
        )}
      </div>
      {editing && (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-2 dark:bg-white/5">
          {programs.map((p) => (
            <fieldset key={p}>
              {programs.length > 1 && <legend className="mb-1 text-xs font-semibold text-zinc-500 uppercase">{p}</legend>}
              <div className="grid grid-cols-2 gap-1">
                {divisions
                  .filter((d) => d.program === p)
                  .map((d) => (
                    <label key={d.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={picked.includes(d.id)}
                        onChange={(e) => setPicked(e.target.checked ? [...picked, d.id] : picked.filter((x) => x !== d.id))}
                      />
                      {d.label}
                    </label>
                  ))}
              </div>
            </fieldset>
          ))}
          <p className="text-xs text-zinc-500">None checked: every division can play here.</p>
          {error && <Alert tone="red">{error}</Alert>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={save}
              className="flex-1 rounded-lg bg-scenic-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPicked(court.divisions);
                setEditing(false);
                setError(null);
              }}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-600 ring-1 ring-zinc-950/10 dark:text-zinc-300 dark:ring-white/15"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
