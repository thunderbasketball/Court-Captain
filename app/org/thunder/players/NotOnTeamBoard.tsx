"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { gradeLabel } from "@/lib/grades";
import type { BoardPlayer, GradeBoard } from "@/lib/rosters";
import { Alert, CloseButton, Toast, dialogCls } from "../../../client-ui";
import { loadAllRosterBoards, movePlayer } from "./actions";
import { RosterZone, type Pick } from "./RosterZone";

type Gender = "Boys" | "Girls";
// A grade's "Not rostered" area.
const freeId = (gender: Gender, grade: string) => `free:${gender}:${grade}`;
const isFree = (zone: string) => zone.startsWith("free:");
const byName = (a: BoardPlayer, b: BoardPlayer) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);

// Home's "Not on a team" tile (Directors of Teams): opens every grade's roster board. Tabs for Boys and Girls; in each,
// grades youngest first, each with its players not on a team, then the teams for that grade. Drag a player onto a team
// (or back to Not rostered); on a phone, tap a player, then tap where they go. Each player shows their coach request.
export default function NotOnTeamBoard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [boards, setBoards] = useState<GradeBoard[] | null>(null);
  const [tab, setTab] = useState<Gender>("Boys");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [picked, setPicked] = useState<Pick | null>(null);
  const changed = useRef(false);

  async function load() {
    const r = await loadAllRosterBoards();
    if (r.ok) setBoards(r.boards);
    else setError(r.message);
  }

  async function move({ id, from }: Pick, to: string) {
    setPicked(null);
    if (!boards || from === to) return;
    const all = boards.flatMap((b) => [...b.unrostered, ...b.teams.flatMap((t) => t.players)]);
    const player = all.find((p) => p.registrantId === id);
    if (!player) return;
    const toFree = isFree(to);
    // Off a team, they go back to their own grade's Not rostered, unless they're still on a 2nd team.
    const onAnother = boards.some((b) => b.teams.some((t) => t.id !== from && t.players.some((p) => p.registrantId === id)));
    const home = boards.find((b) => b.gender === tab && b.grade === player.grade);
    if (toFree && !onAnother && !home) {
      // Their grade has no area on the board yet: reload after the move.
      changed.current = true;
      const r = await movePlayer(id, null, isFree(from) ? null : from);
      if (!r.ok) setToast(`${player.firstName} ${player.lastName}: ${r.message}`);
      return load();
    }
    const without = (list: BoardPlayer[]) => list.filter((p) => p.registrantId !== id);
    // Show the move at once; the server confirms it.
    setBoards(
      boards.map((b) => ({
        ...b,
        unrostered:
          toFree && !onAnother && b === home
            ? [...without(b.unrostered), player].sort(byName)
            : isFree(from)
              ? without(b.unrostered)
              : b.unrostered,
        teams: b.teams.map((t) => ({
          ...t,
          players: t.id === to ? [...without(t.players), player].sort(byName) : t.id === from ? without(t.players) : t.players,
        })),
      })),
    );
    changed.current = true;
    const r = await movePlayer(id, toFree ? null : to, isFree(from) ? null : from);
    if (!r.ok) {
      setToast(`${player.firstName} ${player.lastName}: ${r.message}`);
      await load();
    }
  }

  const shown = boards?.filter((b) => b.gender === tab) ?? [];
  const waiting = (g: Gender) => boards?.filter((b) => b.gender === g).reduce((n, b) => n + b.unrostered.length, 0) ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setBoards(null);
          setError(null);
          setPicked(null);
          changed.current = false;
          dialog.current?.showModal();
          load();
        }}
        className="block w-full text-left"
      >
        {children}
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
              <h2 className="text-lg font-semibold">Not on a team</h2>
              <p className="text-sm text-zinc-500">
                {picked ? "Now tap where this player goes." : "Drag a player onto a team, or tap a player and then a team."}
              </p>
            </div>
            <CloseButton onClick={() => dialog.current?.close()} />
          </div>
          <div role="tablist" aria-label="Gender" className="flex gap-1 border-b border-zinc-200 dark:border-white/10">
            {(["Boys", "Girls"] as const).map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={tab === g}
                onClick={() => {
                  setTab(g);
                  setPicked(null);
                }}
                className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                  tab === g
                    ? "border-thunder-orange text-zinc-900 dark:text-white"
                    : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                }`}
              >
                {g}
                {boards && <span className="ml-1 font-normal text-zinc-500 tabular-nums">({waiting(g)})</span>}
              </button>
            ))}
          </div>
          {error && <Alert tone="red">{error}</Alert>}
          {!boards && !error && <p className="text-sm text-zinc-500">Loading…</p>}
          {boards && !shown.length && <p className="text-sm text-zinc-500">No {tab.toLowerCase()} registered yet.</p>}
          {shown.map((b) => (
            <section key={b.grade} aria-label={gradeLabel(b.grade)} className="space-y-2 pt-1">
              <h3 className="flex items-baseline justify-between gap-2 text-sm font-semibold">
                {gradeLabel(b.grade)}
                <span
                  className={`text-xs font-medium ${b.unrostered.length ? "text-amber-700 dark:text-amber-300" : "text-zinc-500"}`}
                >
                  {b.unrostered.length ? `${b.unrostered.length} not rostered` : "✓ All on a team"}
                </span>
              </h3>
              <RosterZone
                id={freeId(b.gender, b.grade)}
                title="Not rostered"
                players={b.unrostered}
                grade={b.grade}
                free
                picked={picked}
                setPicked={setPicked}
                onMove={move}
              />
              {b.teams.length > 0 ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {b.teams.map((t) => (
                    <RosterZone
                      key={t.id}
                      id={t.id}
                      title={t.name}
                      sub={t.level}
                      players={t.players}
                      grade={b.grade}
                      free={false}
                      picked={picked}
                      setPicked={setPicked}
                      onMove={move}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-500">No teams for this grade yet.</p>
              )}
            </section>
          ))}
        </div>
      </dialog>
    </>
  );
}
