"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { answerGameAction } from "../officiating/actions";

type Answer = "yes" | "no" | null;
export type MyGame = {
  id: string;
  kind: string;
  group: string;
  orgName: string;
  home: string;
  away: string;
  day: string; // "Sat, Nov 14"
  time: string; // "10:00 – 11:30 AM"
  place: string;
  address: string | null;
  directions: string;
  position: number;
  partner: string | null;
  answer: Answer;
  started: boolean;
};

// Games to officiate on the dashboard: a card per date, each game one line (time, place, ✓ and ✗) that opens for the
// rest (teams, address and Directions, referee spot, partner, group). ✓ = good for it, ✗ = can't make it; tapping the
// same one again clears it. Saves at once.
export default function OfficiatingGames({ games, canAnswer }: { games: MyGame[]; canAnswer: boolean }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const answerOf = (g: MyGame) => (g.id in answers ? answers[g.id] : g.answer);

  const answer = (g: MyGame, a: "yes" | "no") => {
    const before = answerOf(g);
    const next = before === a ? null : a;
    setError(null);
    setAnswers((x) => ({ ...x, [g.id]: next }));
    answerGameAction(g.id, next)
      .then((r) => {
        if (!r.ok) {
          setAnswers((x) => ({ ...x, [g.id]: before }));
          setError({ id: g.id, text: r.message });
        } else router.refresh();
      })
      .catch(() => {
        setAnswers((x) => ({ ...x, [g.id]: before }));
        setError({ id: g.id, text: "Couldn't save. Check your connection and try again." });
      });
  };

  const days = [...new Set(games.map((g) => g.day))];
  return (
    <div className="space-y-3">
      {days.map((day) => {
        const list = games.filter((g) => g.day === day);
        const waiting = list.filter((g) => !answerOf(g) && !g.started).length;
        return (
          <div key={day} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
            <p className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2.5 font-semibold dark:border-white/5">
              {day}
              {canAnswer && waiting > 0 && <span className="text-xs font-normal text-amber-700 dark:text-amber-400">{waiting} to answer</span>}
            </p>
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {list.map((g) => {
                const a = answerOf(g);
                return (
                  <li key={g.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-3">
                      <details className="group min-w-0 flex-1">
                        <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                          <span className="min-w-0">
                            <span className="block font-semibold">{g.time}</span>
                            <span className="block truncate text-zinc-500">{g.place}</span>
                          </span>
                          <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="size-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180">
                            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                          </svg>
                        </summary>
                        <div className="mt-2 space-y-1 text-zinc-600 dark:text-zinc-300">
                          <p>
                            <span className="mr-1.5 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-orange-800 uppercase dark:bg-orange-500/15 dark:text-orange-300">
                              {g.kind}
                            </span>
                            {g.home} vs {g.away} <span className="text-zinc-500">· {g.orgName}</span>
                          </p>
                          <p className="text-zinc-500">
                            {g.address ?? g.place} ·{" "}
                            <a href={g.directions} target="_blank" rel="noopener noreferrer" className="font-medium text-thunder-blue hover:underline dark:text-blue-400">
                              Directions
                            </a>
                          </p>
                          <p className="text-xs text-zinc-500">
                            Referee {g.position} · {g.partner ? `with ${g.partner}` : "partner not set yet"} · {g.group}
                          </p>
                        </div>
                      </details>
                      {g.started ? (
                        <span className="shrink-0 text-xs text-zinc-400">Started</span>
                      ) : (
                        <span className="flex shrink-0 gap-2 self-start">
                          <button
                            type="button"
                            disabled={!canAnswer}
                            aria-pressed={a === "yes"}
                            aria-label="I'm good for this game"
                            title="I'm good for this game"
                            onClick={() => answer(g, "yes")}
                            className={`flex size-9 items-center justify-center rounded-full text-lg font-bold ring-1 ${
                              a === "yes"
                                ? "bg-emerald-600 text-white ring-emerald-600"
                                : "text-emerald-600 ring-emerald-300 hover:bg-emerald-50 dark:ring-emerald-500/40 dark:hover:bg-emerald-500/10"
                            }`}
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            disabled={!canAnswer}
                            aria-pressed={a === "no"}
                            aria-label="I can't make this game"
                            title="I can't make this game"
                            onClick={() => answer(g, "no")}
                            className={`flex size-9 items-center justify-center rounded-full text-lg font-bold ring-1 ${
                              a === "no"
                                ? "bg-red-600 text-white ring-red-600"
                                : "text-red-600 ring-red-300 hover:bg-red-50 dark:ring-red-500/40 dark:hover:bg-red-500/10"
                            }`}
                          >
                            ✕
                          </button>
                        </span>
                      )}
                    </div>
                    {error?.id === g.id && <p className="mt-1 text-xs text-red-600">{error.text}</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
