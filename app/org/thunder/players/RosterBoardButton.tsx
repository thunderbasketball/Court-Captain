"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { gradeLabel } from "@/lib/grades";
import type { BoardPlayer, RosterBoard } from "@/lib/rosters";
import { Alert, CloseButton, Toast, dialogCls } from "../../../client-ui";
import { loadRosterBoard, movePlayer } from "./actions";
import { RosterZone, type Pick } from "./RosterZone";

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
  const [picked, setPicked] = useState<Pick | null>(null);
  const changed = useRef(false);

  async function load() {
    const r = await loadRosterBoard(gender, grade);
    if (r.ok) setBoard(r.board);
    else setError(r.message);
  }

  const fitsBoard = (g: string) => gradeSort(g) === gradeSort(grade) || gradeSort(g) === gradeSort(grade) - 1;

  // `from`: the area the player was dragged or picked from (a team, or FREE).
  async function move({ id, from: fromZone }: Pick, to: string) {
    setPicked(null);
    if (!board || fromZone === to) return;
    const player = [...board.unrostered, ...board.teams.flatMap((t) => t.players)].find((p) => p.registrantId === id);
    if (!player) return;
    // Show the move at once; the server confirms it.
    const byName = (a: BoardPlayer, b: BoardPlayer) =>
      a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
    const byGrade = (a: BoardPlayer, b: BoardPlayer) => gradeSort(b.grade) - gradeSort(a.grade) || byName(a, b);
    const without = (list: BoardPlayer[]) => list.filter((p) => p.registrantId !== id);
    const freeNow = without(board.unrostered);
    // They leave only the team they came from (a 2nd team stays).
    const onAnother = board.teams.some((t) => t.id !== fromZone && t.players.some((p) => p.registrantId === id));
    setBoard({
      // The free list holds this grade and one below; anyone else only appears on their team.
      unrostered: to === FREE && !onAnother && fitsBoard(player.grade) ? [...freeNow, player].sort(byGrade) : freeNow,
      teams: board.teams.map((t) => ({
        ...t,
        players: t.id === to ? [...without(t.players), player].sort(byName) : t.id === fromZone ? without(t.players) : t.players,
      })),
    });
    changed.current = true;
    const r = await movePlayer(id, to === FREE ? null : to, fromZone === FREE ? null : fromZone);
    if (!r.ok) {
      setToast(`${player.firstName} ${player.lastName}: ${r.message}`);
      await load();
    }
  }

  // One drop area: "Not on a team" or a team.
  const zone = (id: string, title: string, players: BoardPlayer[], sub?: string) => (
    <RosterZone
      key={id}
      id={id}
      title={title}
      sub={sub}
      players={players}
      grade={grade}
      free={id === FREE}
      picked={picked}
      setPicked={setPicked}
      onMove={move}
    />
  );

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
