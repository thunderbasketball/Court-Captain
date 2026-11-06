"use client";

import { useState } from "react";
import { gradeLabel } from "@/lib/grades";
import type { BoardPlayer } from "@/lib/rosters";

// A picked player: who, and the area they were picked from (a team id, or a "Not rostered" area).
export type Pick = { id: string; from: string };

// One drop area of a roster board: "Not on a team" or a team. Drag a player onto it, or (on a phone) tap a player, then
// tap the area. Each player shows their coach request, and their grade when it isn't the board's. A team's area can be
// collapsed (▸) to just its name and count, and still takes players dropped or tapped onto it.
export function RosterZone({
  id,
  title,
  sub,
  players,
  grade,
  free,
  picked,
  setPicked,
  onMove,
}: {
  id: string;
  title: string;
  sub?: string;
  players: BoardPlayer[];
  grade: string;
  free: boolean;
  picked: Pick | null;
  setPicked: (p: Pick | null) => void;
  onMove: (p: Pick, to: string) => void;
}) {
  const [over, setOver] = useState(false);
  const [shut, setShut] = useState(!free); // teams start collapsed; Not rostered stays open
  const target = picked !== null && picked.from !== id;
  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        try {
          const p = JSON.parse(e.dataTransfer.getData("text/plain")) as Pick;
          if (typeof p?.id === "string" && typeof p.from === "string") onMove(p, id);
        } catch {
          // Not one of our players.
        }
      }}
      onClick={() => picked && onMove(picked, id)}
      className={`rounded-xl p-3 ring-1 transition-colors ${
        over
          ? "bg-blue-50 ring-2 ring-thunder-blue dark:bg-blue-500/10"
          : target
            ? "cursor-pointer ring-thunder-blue/40 hover:bg-blue-50 dark:hover:bg-blue-500/10"
            : "ring-zinc-950/10 dark:ring-white/15"
      } ${free && !over ? "bg-zinc-50 dark:bg-white/5" : ""}`}
    >
      <div className={`flex items-baseline justify-between gap-2 ${shut ? "" : "mb-2"}`}>
        <h3 className="text-sm font-semibold">
          {free ? (
            <>
              {title} <span className="font-normal text-zinc-500 tabular-nums">({players.length})</span>
            </>
          ) : (
            <button
              type="button"
              aria-expanded={!shut}
              onClick={(e) => {
                e.stopPropagation();
                setShut(!shut);
              }}
              className="-m-1 flex items-baseline gap-1 rounded p-1 text-left hover:bg-zinc-100 dark:hover:bg-white/10"
            >
              <span aria-hidden className={`inline-block w-3 text-zinc-500 transition-transform ${shut ? "" : "rotate-90"}`}>
                ▸
              </span>
              {title} <span className="font-normal text-zinc-500 tabular-nums">({players.length})</span>
            </button>
          )}
        </h3>
        {target ? (
          <span className="text-xs font-semibold text-thunder-blue dark:text-blue-400">Tap to move here</span>
        ) : (
          sub && <span className="text-xs text-zinc-500">{sub}</span>
        )}
      </div>
      {!shut && !players.length && (
        <p className="text-xs text-zinc-400">{free ? "Everyone here is on a team." : "Drop players here."}</p>
      )}
      <div className={`flex flex-wrap gap-1.5 ${shut ? "hidden" : ""}`}>
        {players.map((p) => {
          const on = picked?.id === p.registrantId && picked.from === id;
          return (
            <button
              key={p.registrantId}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", JSON.stringify({ id: p.registrantId, from: id } satisfies Pick));
                e.dataTransfer.effectAllowed = "move";
              }}
              onClick={(e) => {
                e.stopPropagation();
                setPicked(on ? null : { id: p.registrantId, from: id });
              }}
              className={`cursor-grab rounded-2xl px-2.5 py-1 text-left text-sm font-medium ring-1 active:cursor-grabbing ${
                on
                  ? "bg-thunder-blue text-white ring-thunder-blue"
                  : "bg-white text-zinc-800 ring-zinc-950/10 hover:ring-thunder-blue/50 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-white/15"
              }`}
            >
              {p.firstName} {p.lastName}
              {p.grade !== grade && <span className={on ? "text-white/80" : "text-zinc-400"}> · {gradeLabel(p.grade)}</span>}
              {p.coachRequest && (
                <span className={`block text-xs font-normal ${on ? "text-white/80" : "text-zinc-500 dark:text-zinc-400"}`}>
                  Coach request: {p.coachRequest}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
