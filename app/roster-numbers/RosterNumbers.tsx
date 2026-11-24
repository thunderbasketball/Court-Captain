"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRosterNumbers } from "./actions";

const box = "w-14 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-center text-base tabular-nums dark:border-white/15 dark:bg-zinc-900";
const digits = (v: string) => v.replace(/\D/g, "").slice(0, 2);

// The Roster card's warning while players have no uniform number: each one with a box, and Save numbers (all or none;
// unique on the team, checked again on the server). Someone who can't change the roster just sees who's missing one.
export function MissingNumbers({
  org,
  teamId,
  players,
  taken,
  canEdit,
}: {
  org: string | null; // null: a League team kept by Scenic City
  teamId: string;
  players: { id: string; first: string; last: string }[];
  taken: string[]; // the numbers already on the team
  canEdit: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!players.length) return null;
  const filled = players.filter((p) => v[p.id]);
  const clash = (p: { id: string }) => !!v[p.id] && (taken.includes(v[p.id]) || players.some((x) => x.id !== p.id && v[x.id] === v[p.id]));
  return (
    <form
      className="mx-4 mb-3 space-y-2 rounded-xl bg-red-50 p-3 ring-1 ring-red-200 dark:bg-red-500/10 dark:ring-red-500/30"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setErr(null);
          const r = await saveRosterNumbers(org, teamId, filled.map((p) => ({ id: p.id, number: v[p.id] })));
          if (!r.ok) return setErr(r.message);
          setV({});
          router.refresh();
        });
      }}
    >
      <p className="text-sm font-semibold text-red-700 dark:text-red-300">
        {players.length} player{players.length === 1 ? " needs" : "s need"} a uniform number
      </p>
      <ul className="space-y-1.5">
        {players.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {p.first} <span className="font-semibold">{p.last}</span>
            </span>
            {canEdit && (
              <span className="flex shrink-0 items-center gap-2">
                {clash(p) && <span className="text-xs font-medium text-red-600 dark:text-red-400">taken</span>}
                <input
                  inputMode="numeric"
                  aria-label={`${p.first} ${p.last}'s number`}
                  placeholder="#"
                  className={box}
                  value={v[p.id] ?? ""}
                  onChange={(e) => setV({ ...v, [p.id]: digits(e.target.value) })}
                />
              </span>
            )}
          </li>
        ))}
      </ul>
      {!canEdit && <p className="text-xs text-zinc-600 dark:text-zinc-300">Your Director sets this roster: ask them to enter the numbers.</p>}
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {canEdit && (
        <button disabled={busy || !filled.length || players.some(clash)} className="w-full rounded-full bg-thunder-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Saving…" : filled.length ? `Save ${filled.length} number${filled.length === 1 ? "" : "s"}` : "Save numbers"}
        </button>
      )}
    </form>
  );
}

// One player's number, in their opened row: change it.
export function PlayerNumber({ org, teamId, id, number }: { org: string | null; teamId: string; id: string; number: string | null }) {
  const router = useRouter();
  const [v, setV] = useState(number ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setErr(null);
          const r = await saveRosterNumbers(org, teamId, [{ id, number: v }]);
          if (!r.ok) return setErr(r.message);
          router.refresh();
        });
      }}
    >
      <span className={number ? "text-zinc-500" : "font-semibold text-red-600 dark:text-red-400"}>Uniform number</span>
      <input inputMode="numeric" aria-label="Uniform number" placeholder="#" className={box} value={v} onChange={(e) => setV(digits(e.target.value))} />
      {v !== (number ?? "") && v !== "" && (
        <button disabled={busy} className="rounded-full bg-thunder-blue px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
      )}
      {err && <span className="text-xs text-red-600 dark:text-red-400">{err}</span>}
    </form>
  );
}
