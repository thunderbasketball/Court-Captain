"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ScoreGame } from "@/lib/scores";
import { timeLabel } from "@/lib/time";
import DirectionsLink from "../DirectionsLink";
import { saveGameScore } from "./actions";

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const box =
  "w-14 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-center text-base tabular-nums dark:border-white/15 dark:bg-zinc-900";

// The Scores card's games, by Game Day (newest first; today's open). Each game: away and home with a score box each,
// or a forfeit, and Save. Saved ones show the final and who entered it (tap to change).
export default function ScoresList({ games, today }: { games: ScoreGame[]; today: string }) {
  if (!games.length) return <p className="text-sm text-zinc-500">No games to score yet: they show here on their Game Day.</p>;
  const days = [...new Set(games.map((g) => g.day))];
  return (
    <div className="space-y-2">
      {days.map((d) => {
        const list = games.filter((g) => g.day === d);
        const left = list.filter((g) => g.homeScore === null && !g.forfeit).length;
        return (
          <details key={d} open={d === days[0] || left > 0} className="overflow-hidden rounded-lg ring-1 ring-zinc-950/10 dark:ring-white/10">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 [&::-webkit-details-marker]:hidden">
              <span className="font-semibold">
                {weekday(d)}
                {d === today && <span className="font-normal text-zinc-500"> · today</span>}
              </span>
              <span className={`text-xs font-medium ${left ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-400"}`}>
                {left ? `${left} to enter` : "All entered ✓"}
              </span>
            </summary>
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-white/5 dark:border-white/5">
              {list.map((g) => (
                <ScoreRow key={g.id} g={g} />
              ))}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

function ScoreRow({ g }: { g: ScoreGame }) {
  const router = useRouter();
  const done = g.homeScore !== null || g.forfeit !== null;
  const [edit, setEdit] = useState(!done);
  const [away, setAway] = useState(g.awayScore?.toString() ?? "");
  const [home, setHome] = useState(g.homeScore?.toString() ?? "");
  const [forfeit, setForfeit] = useState<"" | "home" | "away">(g.forfeit ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 3);
  const save = () =>
    start(async () => {
      setErr(null);
      const r = await saveGameScore(g.id, { home, away, forfeit });
      if (!r.ok) return setErr(r.message);
      setEdit(false);
      router.refresh();
    });
  return (
    <li className="space-y-1.5 px-3 py-2.5 text-sm">
      <p className="text-xs text-zinc-500">
        {g.starts ? timeLabel(g.starts) : "Time TBA"} · {g.group}
        {g.gym && ` · ${g.gym}${g.court ? `, ${g.court}` : ""}`}
        <DirectionsLink href={g.map} />
      </p>
      {!edit ? (
        <button type="button" onClick={() => setEdit(true)} className="flex w-full items-center justify-between gap-2 text-left">
          <span className="min-w-0">
            {g.forfeit ? (
              <>
                <span className="font-medium">{g.forfeit === "home" ? g.away : g.home}</span> wins by forfeit
                <span className="text-zinc-500"> ({g.forfeit === "home" ? g.home : g.away} forfeited)</span>
              </>
            ) : (
              <>
                <span className="font-medium">{g.away}</span> <span className="tabular-nums">{g.awayScore}</span>
                <span className="text-zinc-500"> at </span>
                <span className="font-medium">{g.home}</span> <span className="tabular-nums">{g.homeScore}</span>
              </>
            )}
            {g.scoredBy && <span className="block text-xs text-zinc-400">Final · entered by {g.scoredBy}</span>}
          </span>
          <span className="shrink-0 text-xs font-medium text-thunder-blue">Change</span>
        </button>
      ) : (
        <div className="space-y-2">
          {!forfeit && (
            <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5">
              <span className="min-w-0 truncate">
                <span className="text-xs text-zinc-500">Away · </span>
                {g.away}
              </span>
              <input inputMode="numeric" aria-label={`${g.away} score`} className={box} value={away} onChange={(e) => setAway(digits(e.target.value))} />
              <span className="min-w-0 truncate">
                <span className="text-xs text-zinc-500">Home · </span>
                {g.home}
              </span>
              <input inputMode="numeric" aria-label={`${g.home} score`} className={box} value={home} onChange={(e) => setHome(digits(e.target.value))} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Forfeit"
              value={forfeit}
              onChange={(e) => setForfeit(e.target.value as "" | "home" | "away")}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-white/15 dark:bg-zinc-900"
            >
              <option value="">Played (scores)</option>
              <option value="away">{g.away} forfeited</option>
              <option value="home">{g.home} forfeited</option>
            </select>
            <button type="button" disabled={busy} onClick={save} className="rounded-full bg-thunder-blue px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "Saving…" : "Save"}
            </button>
            {done && (
              <button type="button" onClick={() => setEdit(false)} className="text-sm text-zinc-500">
                Cancel
              </button>
            )}
          </div>
          {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
        </div>
      )}
    </li>
  );
}
