"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gradeLabel } from "@/lib/grades";
import type { BoardPlayer, RosterBoard } from "@/lib/rosters";
import { Alert, CloseButton, Toast, dialogCls } from "../../../client-ui";
import { loadRosterBoard, movePlayer } from "./actions";

const FREE = "free";
const gradeSort = (g: string) => (g === "K" ? 0 : Number(g));

// Director: roster one gender and grade. Drag a player onto a team (or back to "Not on a team");
// on a phone, tap a player, then tap where they go. Moving a player off another team is part of the move.
export default function RosterBoardButton({ gender, grade }: { gender: "Boys" | "Girls"; grade: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [board, setBoard] = useState<RosterBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const changed = useRef(false);

  async function load() {
    const r = await loadRosterBoard(gender, grade);
    if (r.ok) setBoard(r.board);
    else setError(r.message);
  }

  const fitsBoard = (g: string) => gradeSort(g) === gradeSort(grade) || gradeSort(g) === gradeSort(grade) - 1;

  // Where a player is now: a team id, or FREE.
  const whereIs = (b: RosterBoard, id: string) => b.teams.find((t) => t.players.some((p) => p.registrantId === id))?.id ?? FREE;

  async function move(id: string, to: string) {
    setPicked(null);
    setOver(null);
    const fromZone = board && whereIs(board, id);
    if (!board || fromZone === to) return;
    const player = [...board.unrostered, ...board.teams.flatMap((t) => t.players)].find((p) => p.registrantId === id);
    if (!player) return;
    // Show the move at once; the server confirms it.
    const byName = (a: BoardPlayer, b: BoardPlayer) =>
      a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
    const byGrade = (a: BoardPlayer, b: BoardPlayer) => gradeSort(b.grade) - gradeSort(a.grade) || byName(a, b);
    const without = (list: BoardPlayer[]) => list.filter((p) => p.registrantId !== id);
    const freeNow = without(board.unrostered);
    setBoard({
      // The free list holds this grade and one below; anyone else only appears on their team.
      unrostered: to === FREE && fitsBoard(player.grade) ? [...freeNow, player].sort(byGrade) : freeNow,
      teams: board.teams.map((t) => ({
        ...t,
        players: t.id === to ? [...without(t.players), player].sort(byName) : without(t.players),
      })),
    });
    changed.current = true;
    const r = await movePlayer(id, to === FREE ? null : to, !fromZone || fromZone === FREE ? null : fromZone);
    if (!r.ok) {
      setToast(`${player.firstName} ${player.lastName}: ${r.message}`);
      await load();
    }
  }

  // One drop area: "Not on a team" or a team.
  const zone = (id: string, title: string, players: BoardPlayer[], sub?: string) => {
    const target = picked !== null && board && whereIs(board, picked) !== id;
    return (
      <section
        key={id}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(id);
        }}
        onDragLeave={() => setOver((o) => (o === id ? null : o))}
        onDrop={(e) => {
          e.preventDefault();
          const p = e.dataTransfer.getData("text/plain");
          if (p) move(p, id);
        }}
        onClick={() => picked && move(picked, id)}
        className={`rounded-xl p-3 ring-1 transition-colors ${
          over === id
            ? "bg-blue-50 ring-2 ring-thunder-blue dark:bg-blue-500/10"
            : target
              ? "cursor-pointer ring-thunder-blue/40 hover:bg-blue-50 dark:hover:bg-blue-500/10"
              : "ring-zinc-950/10 dark:ring-white/15"
        } ${id === FREE ? "bg-zinc-50 dark:bg-white/5" : ""}`}
      >
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {title} <span className="font-normal text-zinc-500 tabular-nums">({players.length})</span>
          </h3>
          {sub && <span className="text-xs text-zinc-500">{sub}</span>}
          {target && <span className="text-xs font-semibold text-thunder-blue dark:text-blue-400">Tap to move here</span>}
        </div>
        {!players.length && (
          <p className="text-xs text-zinc-400">{id === FREE ? "Everyone here is on a team." : "Drop players here."}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {players.map((p) => {
            const on = picked === p.registrantId;
            return (
              <button
                key={p.registrantId}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", p.registrantId);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setPicked(on ? null : p.registrantId);
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
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setBoard(null);
          setError(null);
          setPicked(null);
          changed.current = false;
          dialog.current?.showModal();
          load();
        }}
        className="shrink-0 rounded-full bg-thunder-blue px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white shadow-sm hover:bg-thunder-blue-dark"
      >
        Roster players
      </button>
      {toast && <Toast key={toast} message={toast} />}
      <dialog
        ref={dialog}
        className={`${dialogCls} sm:max-w-2xl`}
        onClose={() => changed.current && router.refresh()}
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      >
        <div className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                Roster {gender} · {gradeLabel(grade)}
              </h2>
              <p className="text-sm text-zinc-500">
                {picked ? "Now tap where this player goes." : "Drag a player onto a team, or tap a player and then a team."}
              </p>
            </div>
            <CloseButton onClick={() => dialog.current?.close()} />
          </div>
          {error && <Alert tone="red">{error}</Alert>}
          {!board && !error && <p className="text-sm text-zinc-500">Loading…</p>}
          {board && (
            <>
              {zone(FREE, "Not on a team", board.unrostered)}
              {!board.teams.length && <p className="text-sm text-zinc-500">No teams for this grade yet. Create one on Teams.</p>}
              <div className="grid gap-3 sm:grid-cols-2">{board.teams.map((t) => zone(t.id, t.name, t.players, t.level))}</div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
