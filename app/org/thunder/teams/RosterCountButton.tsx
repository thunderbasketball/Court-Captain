"use client";

import { useRef } from "react";
import { gradeLabel } from "@/lib/grades";
import type { TeamListItem } from "@/lib/teams";
import { CloseButton, dialogCls } from "../../../client-ui";

// Team card: how many players are rostered; tapping it pops up the roster.
export default function RosterCountButton({ team }: { team: Pick<TeamListItem, "name" | "players"> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();
  const n = team.players.length;
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-label={`${team.name} roster, ${n} ${n === 1 ? "player" : "players"}`}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-zinc-600 tabular-nums ring-1 ring-zinc-950/15 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-white/20 dark:hover:bg-white/10"
      >
        👥 {n}
      </button>
      <dialog ref={dialog} className={dialogCls} onClick={(e) => e.target === dialog.current && close()}>
        <div className="flex max-h-[85vh] flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{team.name} roster</h2>
              <p className="text-sm text-zinc-500">
                {n} {n === 1 ? "player" : "players"}
              </p>
            </div>
            <CloseButton onClick={close} />
          </div>
          {!n && <p className="mt-3 text-sm text-zinc-500">No players yet. Roster them from Players → Roster players.</p>}
          <ul className="mt-3 min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto dark:divide-white/5">
            {team.players.map((p) => (
              <li key={p.registrantId} className="py-2">
                <span className="block text-sm font-medium">
                  {p.first} <span className="font-semibold">{p.last}</span>
                </span>
                <span className="block text-xs text-zinc-400">
                  {gradeLabel(p.grade)} · Rostered by {p.rosteredBy}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
