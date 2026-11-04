"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, useConfirm } from "../../../client-ui";
import { createMatchups, saveMatchups } from "../actions";

export type BoardTeam = { id: string; name: string; group: string; need: number };
type Game = { key: string; a: string | null; b: string | null };
type Side = "a" | "b";
// A picked team: which one, and where from ("sandbox", or a game's side "<game key>:a").
type Picked = { team: string; from: string };

const pairKey = (a: string, b: string) => (BigInt(a) < BigInt(b) ? `${a}-${b}` : `${b}-${a}`);
const shortDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const sign = (games: Game[]) =>
  games
    .filter((g) => g.a && g.b)
    .map((g) => pairKey(g.a!, g.b!))
    .sort()
    .join(",");

// One division's matchups on a Game Day, arranged by hand: drag a team (or, on a phone, tap it, then tap where it
// goes) between games and the Sandbox. Dropping on a team swaps them. Save sends the games to the server, which
// checks them all again. Create matchups (again) lets the app pair them.
export function MatchupBoard({
  programId,
  day,
  divisionId,
  division,
  teams,
  initial,
  otherDays,
}: {
  programId: string;
  day: string;
  divisionId: string;
  division: string;
  teams: BoardTeam[];
  initial: [string | null, string | null][]; // a game whose team was taken out comes with that side empty
  otherDays: Record<string, string[]>;
}) {
  const router = useRouter();
  const start0 = initial.map(([a, b], i) => ({ key: `g${i}`, a, b }));
  const [games, setGames] = useState<Game[]>(start0);
  const [next, setNext] = useState(initial.length);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null); // the team being dragged
  // The team being dragged or tapped: every team it already plays lights up (other Game Days amber, today red).
  const active = dragging ?? picked?.team ?? null;
  const playsToday = (x: string, y: string) => games.some((g) => (g.a === x && g.b === y) || (g.a === y && g.b === x));
  const [note, setNote] = useState<{ tone: "green" | "red"; lines: string[] } | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const team = new Map(teams.map((t) => [t.id, t]));
  const placed = (id: string) => games.reduce((n, g) => n + (g.a === id ? 1 : 0) + (g.b === id ? 1 : 0), 0);
  const sandbox = teams.filter((t) => placed(t.id) < t.need);
  const dirty = sign(games) !== sign(start0) || games.some((g) => !g.a || !g.b);
  const dupes = new Set(
    games
      .filter((g) => g.a && g.b)
      .map((g) => pairKey(g.a!, g.b!))
      .filter((k, i, all) => all.indexOf(k) !== i),
  );

  // Move the picked team to a game's side, the Sandbox, or a new game. A team already there swaps into its place.
  function move(p: Picked, to: string) {
    setPicked(null);
    setNote(null);
    if (p.from === to) return;
    const fromSlot = p.from === "sandbox" ? null : (p.from.split(":") as [string, Side]);
    let list = games.map((g) => ({ ...g }));
    const slot = (k: string) => list.find((g) => g.key === k)!;
    if (to === "sandbox") {
      if (fromSlot) slot(fromSlot[0])[fromSlot[1]] = null;
    } else {
      let target: [string, Side];
      if (to === "new") {
        const k = `g${next}`;
        setNext(next + 1);
        list.push({ key: k, a: null, b: null });
        target = [k, "a"];
      } else target = to.split(":") as [string, Side];
      const into = slot(target[0]);
      const was = into[target[1]];
      const other = into[target[1] === "a" ? "b" : "a"];
      if (other === p.team) return setNote({ tone: "red", lines: [`${team.get(p.team)?.name} can't play itself.`] });
      if (!fromSlot && was !== p.team && placed(p.team) >= (team.get(p.team)?.need ?? 0))
        return setNote({ tone: "red", lines: [`${team.get(p.team)?.name} already has all its games.`] });
      into[target[1]] = p.team;
      if (fromSlot) {
        const back = slot(fromSlot[0]);
        // A swap: the team that was here goes where the picked one came from (unless it would play itself).
        back[fromSlot[1]] = was && back[fromSlot[1] === "a" ? "b" : "a"] !== was ? was : null;
      }
    }
    list = list.filter((g) => g.a || g.b);
    setGames(list);
  }

  const dropProps = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(id);
    },
    onDragLeave: () => setOver((o) => (o === id ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      setDragging(null);
      try {
        const p = JSON.parse(e.dataTransfer.getData("text/plain")) as Picked;
        if (typeof p?.team === "string" && typeof p.from === "string") move(p, id);
      } catch {
        // Not one of our teams.
      }
    },
    onClick: () => picked && move(picked, id),
  });
  const ring = (id: string) =>
    over === id
      ? "bg-sky-50 ring-2 ring-scenic-navy dark:bg-sky-500/10 dark:ring-white"
      : picked && picked.from !== id
        ? "cursor-pointer ring-1 ring-scenic-navy/40 hover:bg-sky-50 dark:ring-white/40 dark:hover:bg-sky-500/10"
        : "ring-1 ring-zinc-950/10 dark:ring-white/15";

  function chip(id: string, from: string) {
    const t = team.get(id);
    const on = picked?.team === id && picked.from === from;
    const other = active && active !== id;
    const before = other ? otherDays[pairKey(active, id)] : undefined;
    const today = other ? playsToday(active, id) : false;
    return (
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", JSON.stringify({ team: id, from }));
          setDragging(id);
        }}
        onDragEnd={() => setDragging(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (picked && picked.from !== from) return move(picked, from); // tap a team to swap with it
          setPicked(on ? null : { team: id, from });
        }}
        className={`${from === "sandbox" ? "max-w-full" : "block h-full w-full"} cursor-grab rounded-md px-2 py-1 text-left text-sm shadow-sm active:cursor-grabbing ${
          on || dragging === id
            ? "bg-scenic-navy text-white ring-1 ring-scenic-navy"
            : today
              ? "bg-red-50 ring-2 ring-red-500 dark:bg-red-500/15"
              : before
                ? "bg-amber-50 ring-2 ring-amber-500 dark:bg-amber-500/15"
                : "bg-white ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15"
        }`}
      >
        <span className="block truncate font-medium">{t?.name ?? "A removed team"}</span>
        <span className={`block text-[11px] ${on || dragging === id ? "text-white/80" : "text-zinc-500"}`}>
          {t?.group}
          {today && <span className="ml-1 font-semibold text-red-700 dark:text-red-300">· Plays today</span>}
          {before && (
            <span className="ml-1 font-semibold text-amber-800 dark:text-amber-300">
              · Played {before.map(shortDay).join(", ")}
            </span>
          )}
        </span>
      </button>
    );
  }

  const save = () =>
    start(async () => {
      const full = games.filter((g) => g.a && g.b).map((g) => [g.a!, g.b!] as [string, string]);
      const r = await saveMatchups(programId, day, divisionId, full);
      setNote(
        r.ok
          ? { tone: "green", lines: [`Saved ${r.saved} matchup${r.saved === 1 ? "" : "s"}.`] }
          : { tone: "red", lines: [r.message] },
      );
      if (r.ok) router.refresh();
    });

  const create = async () => {
    if (
      (initial.length || dirty) &&
      !(await confirm({
        title: `Create ${division}'s matchups again?`,
        message: "The app pairs the teams again, replacing these matchups for this day.",
        confirmLabel: "Create again",
      }))
    )
      return;
    start(async () => {
      const r = await createMatchups(programId, day, divisionId);
      if (!r.ok) return setNote({ tone: "red", lines: [r.message] });
      setNote({
        tone: "green",
        lines: [
          `${r.created} matchup${r.created === 1 ? "" : "s"} created.`,
          ...r.short,
          ...r.repeats.map((x) => `Played before: ${x}`),
        ],
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Drag a team to change a matchup (or tap it, then tap where it goes). Drop on a team to swap them. While you drag, teams it
        already plays light up: <span className="font-semibold text-amber-700 dark:text-amber-300">amber</span> on another Game
        Day, <span className="font-semibold text-red-600 dark:text-red-400">red</span> today.
      </p>
      <ul className="space-y-1">
        {games.map((g) => {
          const met = g.a && g.b ? otherDays[pairKey(g.a, g.b)] : undefined;
          const twice = g.a && g.b && dupes.has(pairKey(g.a, g.b));
          return (
            <li key={g.key} className="rounded-lg bg-zinc-50 p-1 dark:bg-white/5">
              {/* A tag only when something needs attention: the pair meets on another Game Day, or twice today. */}
              {(met || twice) && (
                <div className="mb-0.5 flex justify-end gap-2 px-1 text-[11px]">
                  {met && (
                    <span className="rounded-full bg-amber-100 px-1.5 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                      Also {met.map(shortDay).join(", ")}
                    </span>
                  )}
                  {twice && <span className="font-semibold text-red-600 dark:text-red-400">Same matchup twice</span>}
                </div>
              )}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                {(["a", "b"] as const).map((side, j) => {
                  const id = `${g.key}:${side}`;
                  const who = g[side];
                  return (
                    <div key={side} className="contents">
                      {j === 1 && <span className="text-xs font-semibold text-zinc-400">vs</span>}
                      <div {...dropProps(id)} className={`min-h-10 rounded-md p-0.5 ${ring(id)}`}>
                        {who ? (
                          chip(who, id)
                        ) : (
                          <span className="block px-1 py-2 text-center text-xs text-zinc-400">Drop an opponent</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <div
        {...dropProps("new")}
        className={`rounded-xl border border-dashed border-zinc-300 p-2 text-center text-xs text-zinc-500 dark:border-white/20 ${ring("new")}`}
      >
        + Drop a team here to start a new game
      </div>
      <section {...dropProps("sandbox")} className={`rounded-xl p-2 ${ring("sandbox")} bg-amber-50/50 dark:bg-amber-500/5`}>
        <h4 className="mb-1.5 flex items-baseline justify-between text-sm font-semibold">
          Sandbox
          <span className="text-xs font-normal text-zinc-500">Teams not in a matchup</span>
        </h4>
        {sandbox.length ? (
          <div className="flex flex-wrap gap-1.5">
            {sandbox.map((t) => (
              <div key={t.id} className="flex items-center gap-1">
                {chip(t.id, "sandbox")}
                {t.need - placed(t.id) > 1 && <span className="text-[11px] text-zinc-500">×{t.need - placed(t.id)}</span>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-400">Every team has its games. Drop a team here to take it out of a game.</p>
        )}
      </section>
      {note && (
        <Alert tone={note.tone}>
          {note.lines.map((l) => (
            <span key={l} className="block">
              {l}
            </span>
          ))}
        </Alert>
      )}
      <div className="flex gap-2">
        {dirty && (
          <>
            <button
              type="button"
              disabled={busy || dupes.size > 0}
              onClick={save}
              className="flex-1 rounded-lg bg-scenic-navy px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setGames(start0);
                setPicked(null);
                setNote(null);
              }}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-600 ring-1 ring-zinc-950/10 dark:text-zinc-300 dark:ring-white/15"
            >
              Undo
            </button>
          </>
        )}
        {!dirty && (
          <button
            type="button"
            disabled={busy}
            onClick={create}
            className="flex-1 rounded-lg bg-scenic-navy px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Creating…" : initial.length ? "Create matchups again" : "Create matchups"}
          </button>
        )}
      </div>
      {dirty && games.some((g) => !g.a || !g.b) && (
        <p className="text-xs text-zinc-500">A game with one team isn&apos;t saved; that team stays in the Sandbox.</p>
      )}
      {dialog}
    </div>
  );
}
