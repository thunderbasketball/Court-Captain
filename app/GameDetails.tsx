"use client";

import { useState, type ReactNode } from "react";
import type { GameDetails as Details, TeamStats } from "@/lib/game-details";
import { loadGameDetails } from "./game-details/actions";

const short = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  });
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex justify-between gap-2 px-3 py-1.5">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className={`font-medium tabular-nums ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

function TeamCard({ t }: { t: TeamStats }) {
  const none = "–";
  return (
    <div className="overflow-hidden rounded-lg bg-white ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
      <div className="flex items-center justify-between gap-2 bg-zinc-50 px-3 py-2 dark:bg-white/5">
        <span className="min-w-0">
          <span className="block truncate font-semibold">{t.name}</span>
          <span className="text-[11px] font-semibold text-zinc-500 uppercase">
            {t.side}
          </span>
        </span>
        <span className="flex shrink-0 gap-1">
          <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs font-bold text-white tabular-nums dark:bg-zinc-200 dark:text-zinc-900">
            {t.wins}-{t.losses}
          </span>
          <span
            className="rounded-md bg-scenic-navy px-1.5 py-0.5 text-xs font-bold text-white tabular-nums"
            title="Power Index (0–1000)"
          >
            PI {t.pi}
          </span>
        </span>
      </div>
      <div className="divide-y divide-zinc-100 text-xs dark:divide-white/5">
        <Row
          label="Points per game"
          value={t.ppg === null ? none : String(t.ppg)}
        />
        <Row
          label="Point differential"
          value={t.diff === null ? none : signed(t.diff)}
          tone={
            t.diff === null
              ? ""
              : t.diff > 0
                ? "text-emerald-700 dark:text-emerald-400"
                : t.diff < 0
                  ? "text-red-600 dark:text-red-400"
                  : ""
          }
        />
        <Row label="Streak" value={t.streak ?? none} />
      </div>
      {/* The season's record; opens to every result, newest first. */}
      <details className="group/r border-t border-zinc-100 text-xs dark:border-white/5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-1.5 [&::-webkit-details-marker]:hidden">
          <span className="text-zinc-600 dark:text-zinc-400">
            {t.games.length > 0 && (
              <span
                aria-hidden
                className="mr-1 inline-block text-zinc-400 transition group-open/r:rotate-90"
              >
                ›
              </span>
            )}
            Season record
          </span>
          <span className="font-medium tabular-nums">
            {t.wins}-{t.losses}
          </span>
        </summary>
        <div className="px-3 pb-1.5">
          {t.games.length ? (
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {t.games.map((g, i) => (
                <li key={i} className="flex items-center gap-2 py-1">
                  <span className="w-9 shrink-0 text-zinc-500 tabular-nums">
                    {short(g.date)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{g.opponent}</span>
                  <span className="shrink-0 tabular-nums">
                    <span
                      className={`font-bold ${g.result === "W" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                    >
                      {g.result}
                    </span>{" "}
                    {g.score}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pb-1 text-zinc-500">No scores yet.</p>
          )}
        </div>
      </details>
    </div>
  );
}

// A League game's line in a schedule (an <li>): a tap anywhere on it (but its share button or Directions) opens its stats
// right under it: both teams' record, PI, points and every result (loaded when first opened, so schedules stay fast).
// `id` null: a plain line (not published yet, or no opponent).
export default function GameItem({ id, className, children }: { id: string | null; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Details | null | "loading" | "none">(null);
  if (!id) return <li className={className}>{children}</li>;
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && (data === null || data === "none")) {
      setData("loading");
      const d = await loadGameDetails(id!);
      setData(d ?? "none");
    }
  }
  return (
    <li
      className={`${className ?? ""} cursor-pointer`}
      tabIndex={0}
      title={open ? "Tap to hide the game details" : "Tap for game details"}
      onClick={(e) => {
        // Its own buttons and links (share, Directions) do only their own thing; inside the stats, only the season record opens.
        if ((e.target as HTMLElement).closest("a, button, summary, input, [data-game-stats]")) return;
        toggle();
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {children}
      {open && (
        <div data-game-stats className="mt-2 w-full basis-full cursor-default">
          {data === "loading" && <p className="text-xs text-zinc-500">Loading…</p>}
          {data === "none" && <p className="text-xs text-zinc-500">No details for this game yet.</p>}
          {data && typeof data === "object" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <TeamCard t={data.teams[0]} />
              <TeamCard t={data.teams[1]} />
            </div>
          )}
        </div>
      )}
    </li>
  );
}
