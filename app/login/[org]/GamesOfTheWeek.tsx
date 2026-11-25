"use client";

import { useState } from "react";
import type { GamesOfTheWeek as Week, GotwGame, GotwTeam } from "@/lib/games-of-week";
import { GOTW_RULES } from "@/lib/games-of-week";
import { timeLabel } from "@/lib/time";
import DirectionsLink from "../../DirectionsLink";
import { genderBg, genderOf } from "../../ui";

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const record = (t: GotwTeam) => `${t.w}–${t.l}, PI ${t.pi}`;

// Games of the Week on the public page (above Programs): a REC card and a COMP card, the coming Game Day's 5 best
// matchups each (where, when, each team's record). ⓘ opens how games qualify. Before any scores: says so.
export default function GamesOfTheWeek({ week }: { week: Week }) {
  return (
    <section className="mt-4 space-y-2">
      <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
        Games of the Week{week.day && <span className="font-normal normal-case"> · {weekday(week.day)}</span>}
      </h2>
      <GotwCard level="REC" games={week.rec} day={week.day} />
      <GotwCard level="COMP" games={week.comp} day={week.day} />
    </section>
  );
}

function GotwCard({ level, games, day }: { level: "REC" | "COMP"; games: GotwGame[]; day: string | null }) {
  const [info, setInfo] = useState(false);
  return (
    <div className="rounded-xl bg-white p-3 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <span
            className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
              level === "COMP"
                ? "bg-orange-50 text-orange-700 ring-orange-300 dark:bg-orange-500/10 dark:text-orange-300"
                : "bg-sky-50 text-sky-700 ring-sky-300 dark:bg-sky-500/10 dark:text-sky-300"
            }`}
          >
            {level}
          </span>
          Games of the Week
        </p>
        <button
          type="button"
          aria-expanded={info}
          aria-label="How games qualify"
          title="How games qualify"
          onClick={() => setInfo((x) => !x)}
          className={`flex size-7 items-center justify-center rounded-full text-sm font-semibold ring-1 ${
            info ? "bg-thunder-blue text-white ring-thunder-blue" : "text-zinc-500 ring-zinc-950/15 dark:ring-white/20"
          }`}
        >
          i
        </button>
      </div>
      {info && (
        <div className="mt-2 rounded-lg bg-zinc-50 p-2.5 text-xs text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
          <p className="mb-1 font-semibold">How games qualify</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {GOTW_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {games.length ? (
        <ol className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-white/5">
          {games.map((g, i) => (
            <li key={i} className={`-mx-1 flex gap-3 rounded-lg px-1 py-2 ${genderBg(genderOf(g.group))}`}>
              <span className="w-5 shrink-0 pt-0.5 text-center font-semibold text-zinc-400">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block">
                  <span className="font-medium">{g.away.name}</span> <span className="text-zinc-500">({record(g.away)})</span>{" "}
                  <span className="text-zinc-500">at</span> <span className="font-medium">{g.home.name}</span>{" "}
                  <span className="text-zinc-500">({record(g.home)})</span>
                </span>
                <span className="block text-xs text-zinc-500">
                  {g.starts ? timeLabel(g.starts) : "Time TBA"} · {g.group}
                  {g.gym && ` · ${g.gym}${g.court ? `, ${g.court}` : ""}`}
                  <DirectionsLink href={g.map} />
                </span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">
          {day
            ? "No games qualify yet: Games of the Week start once teams have records (after their first games are scored)."
            : "Games of the Week start once the schedule is posted and teams have records."}
        </p>
      )}
    </div>
  );
}
