"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { correctGame } from "../actions";

// A game to correct: TBD in a team's place (its opponent keeps its time), or remove the game.
export default function CorrectButtons({ id, teams }: { id: string; teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = (team: string | null) =>
    start(async () => {
      setError(null);
      const r = await correctGame(id, team);
      if (!r.ok) return setError(r.message);
      router.refresh();
    });
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {teams.map((t) => (
          <button key={t.id} type="button" disabled={busy} onClick={() => go(t.id)} className="rounded-full px-3 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/40 disabled:opacity-50 dark:text-blue-400">
            Put TBD for {t.name}
          </button>
        ))}
        <button type="button" disabled={busy} onClick={() => go(null)} className="rounded-full px-3 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-600/30 disabled:opacity-50 dark:text-red-400">
          Remove the game
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
