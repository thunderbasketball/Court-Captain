"use client";

import { CoachBadge, LevelTag, TeamName, type CoachTag } from "../../../ui";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, useConfirm } from "../../../client-ui";
import { addGame, clearMatchups, createMatchups, fillTbd, saveMatchups, switchHome } from "../actions";
import { announce } from "./board-events";

// group: "4th REC"; level: REC or COMP; coach: set when its coach has another team playing that day.
export type BoardTeam = { id: string; name: string; group: string; level: string; coach?: CoachTag; need: number; division?: string; grade?: number; gender?: string };
// A game: two sides; one empty side is TBD (no opponent yet). home: the home side as saved (unknown once changed).
// fill: the team in it filling in for a TBD (an extra game for it). id, placed: as saved.
type Game = { key: string; a: string | null; b: string | null; home: Side | null; fill: string | null; id?: string; placed?: boolean; tbd?: boolean; wrong?: string | null };
export type BoardGame = { id: string; a: string | null; b: string | null; home: Side | null; fill: string | null; placed: boolean; tbd: boolean; wrong: string | null };
type Side = "a" | "b";
// A picked team: which one, and where from ("sandbox", or a game's side "<game key>:a").
type Picked = { team: string; from: string };

const VIEW_ONLY = "View only: only Directors of Scheduling change the schedule.";
const TBD = "TBD"; // the TBD chip
const pairKey = (a: string, b: string) => (BigInt(a) < BigInt(b) ? `${a}-${b}` : `${b}-${a}`);
const shortDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const gameKey = (g: { a: string | null; b: string | null }) => (g.a && g.b ? pairKey(g.a, g.b) : `${g.a ?? g.b}-TBD`);
const sign = (games: Game[]) =>
  games
    .filter((g) => g.a || g.b)
    .map(gameKey)
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
  everyone,
  initial,
  otherDays,
  fills,
  published,
  readOnly = false,
}: {
  readOnly?: boolean; // Admins and Owners: they see it; only Directors of Scheduling change it
  programId: string;
  day: string;
  divisionId: string;
  division: string;
  teams: BoardTeam[];
  everyone: BoardTeam[]; // every team playing that day, any division (a TBD can be any of them)
  initial: BoardGame[]; // a TBD game (or one whose team was taken out) has one side empty
  otherDays: Record<string, string[]>;
  fills: Record<string, string[]>; // team → the Game Days it has filled in for a TBD
  published: string[]; // levels published that day: their games stay as they are
}) {
  const router = useRouter();
  const start0 = initial.map((g, i) => ({ key: `g${i}`, ...g }));
  const [games, setGames] = useState<Game[]>(start0);
  const [next, setNext] = useState(initial.length);
  const [picked, setPicked] = useState<Picked | null>(null);
  // After a save elsewhere (home and away switched, a game placed) the page refreshes with the server's games: take them in,
  // unless there are changes here not saved yet.
  const sig0 = JSON.stringify(initial);
  const [seen, setSeen] = useState({ sig: sig0, start: start0 });
  if (seen.sig !== sig0) {
    // Nothing unsaved here, or what's here is what was just saved (take the server's home sides too).
    const clean = sign(games) === sign(seen.start) || sign(games) === sign(start0);
    setSeen({ sig: sig0, start: start0 });
    if (clean) {
      setGames(start0);
      setNext(initial.length);
      setPicked(null);
    }
  }
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null); // the team being dragged
  // The team being dragged or tapped: every team it already plays lights up (other Game Days amber, today red).
  const active = dragging ?? (picked && picked.team !== TBD ? picked.team : null);
  const playsToday = (x: string, y: string) => games.some((g) => (g.a === x && g.b === y) || (g.a === y && g.b === x));
  const [note, setNote] = useState<{ tone: "green" | "red"; lines: string[] } | null>(null);
  const [busy, start] = useTransition();
  const [working, setWorking] = useState<string | null>(null); // the button pressed ("create REC", "clear COMP"): only it says Working…
  const [confirm, dialog] = useConfirm();
  const team = new Map([...everyone, ...teams].map((t) => [t.id, t]));
  const [manual, setManual] = useState(false); // a TBD in the New game box: picking both teams
  const locked = (id: string | null | undefined) => !!id && published.includes(team.get(id)?.level ?? "");
  // A game's level is its teams' (a fill-in's game: the team it fills in for).
  const gameLocked = (g: Game | undefined) => !!g && (g.fill ? locked(g.a === g.fill ? g.b : g.a) : locked(g.a) || locked(g.b));
  const placed = (id: string) => games.reduce((n, g) => n + (g.fill === id ? 0 : (g.a === id ? 1 : 0) + (g.b === id ? 1 : 0)), 0);
  const sandbox = teams.filter((t) => placed(t.id) < t.need);
  const dirty = sign(games) !== sign(start0);
  const dupes = new Set(
    games
      .filter((g) => g.a || g.b)
      .map(gameKey)
      .filter((k, i, all) => all.indexOf(k) !== i),
  );

  // Move the picked team to a game's side, the Sandbox, or a new game. A team already there swaps into its place.
  function move(p: Picked, to: string) {
    setPicked(null);
    setNote(null);
    if (p.from === to) return;
    if (p.team === TBD) {
      // TBD: into the New game box it makes a game by hand; onto a team it takes its place.
      if (to === "new") {
        if (dirty) return setNote({ tone: "red", lines: ["Save or undo your changes first."] });
        return setManual(true);
      }
      const [k, side] = to.split(":") as [string, Side];
      const g = games.find((x) => x.key === k);
      if (!g || !g[side]) return;
      if (gameLocked(g)) return setNote({ tone: "red", lines: ["Those games are published, so they can't be changed. Unpublish that level for the day first."] });
      if (!g[side === "a" ? "b" : "a"]) return;
      return setGames(games.map((x) => (x.key === k ? { ...x, [side]: null, home: null, fill: null } : x)));
    }
    if (to !== "sandbox" && !teams.some((t) => t.id === p.team)) return setNote({ tone: "red", lines: [`${team.get(p.team)?.name} is from another division: take it out with Back to TBD, or pick it in a TBD.`] });
    const into0 = to.includes(":") ? games.find((g) => g.key === to.split(":")[0]) : undefined;
    const from0 = p.from.includes(":") ? games.find((g) => g.key === p.from.split(":")[0]) : undefined;
    if ((from0 ? gameLocked(from0) : locked(p.team)) || gameLocked(into0))
      return setNote({ tone: "red", lines: ["Those games are published, so they can't be changed. Unpublish that level for the day first."] });
    const fromSlot = p.from === "sandbox" ? null : (p.from.split(":") as [string, Side]);
    let list = games.map((g) => ({ ...g }));
    const slot = (k: string) => list.find((g) => g.key === k)!;
    if (to === "sandbox") {
      if (fromSlot) {
        slot(fromSlot[0])[fromSlot[1]] = null;
        slot(fromSlot[0]).home = null;
        slot(fromSlot[0]).fill = null;
      }
    } else {
      let target: [string, Side];
      if (to === "new") {
        const k = `g${next}`;
        setNext(next + 1);
        list.push({ key: k, a: null, b: null, home: null, fill: null });
        target = [k, "a"];
      } else target = to.split(":") as [string, Side];
      const into = slot(target[0]);
      const was = into[target[1]];
      const other = into[target[1] === "a" ? "b" : "a"];
      // A team dropped on the other side of its own game (its opponent, or TBD): switch home and away (saved at once).
      if (fromSlot && fromSlot[0] === target[0] && other === p.team) return flipHome(into);
      if (other === p.team) return setNote({ tone: "red", lines: [`${team.get(p.team)?.name} can't play itself.`] });
      if (!fromSlot && was !== p.team && placed(p.team) >= (team.get(p.team)?.need ?? 0))
        return setNote({ tone: "red", lines: [`${team.get(p.team)?.name} already has all its games.`] });
      into[target[1]] = p.team;
      into.fill = null;
      into.home = null; // home and away are set again when saved
      if (fromSlot) {
        const back = slot(fromSlot[0]);
        back.home = null;
        back.fill = null;
        // A swap: the team that was here goes where the picked one came from (unless it would play itself).
        back[fromSlot[1]] = was && back[fromSlot[1] === "a" ? "b" : "a"] !== was ? was : null;
      }
    }
    // REC never plays COMP (a swap can't make one either).
    const mixed = list.find((g) => g.a && g.b && !g.fill && team.get(g.a)?.level !== team.get(g.b)?.level);
    if (mixed) {
      const [x, y] = [team.get(mixed.a!)!, team.get(mixed.b!)!];
      return setNote({
        tone: "red",
        lines: [`${x.name} is ${x.level} and ${y.name} is ${y.level}: REC and COMP teams never play each other.`],
      });
    }
    // A fill-in left alone had only the extra game: it goes too.
    list = list.filter((g) => g.a || g.b);
    setGames(list);
    return list;
  }

  // Every change here is saved at once (with the others not saved yet), so the Grid always shows the matchups.
  const act = (p: Picked, to: string) => {
    if (readOnly) return setNote({ tone: "red", lines: [VIEW_ONLY] });
    const list = move(p, to);
    if (!list) return;
    // Saved games whose teams changed: the Grid shows them at once (the left team home until the save says otherwise).
    announce(
      list.flatMap((g) => {
        const was = games.find((x) => x.key === g.key);
        return g.id && was && (was.a !== g.a || was.b !== g.b) ? [{ id: g.id, home: g.a, away: g.b }] : [];
      }),
    );
    save(list);
  };

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
        if (typeof p?.team === "string" && typeof p.from === "string") act(p, id);
      } catch {
        // Not one of our teams.
      }
    },
    onClick: () => picked && act(picked, id),
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
        draggable={!locked(id) && !readOnly}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", JSON.stringify({ team: id, from }));
          setDragging(id);
        }}
        onDragEnd={() => setDragging(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (picked && picked.from !== from) return act(picked, from); // tap a team to swap with it
          if (locked(id)) return;
          setPicked(on ? null : { team: id, from });
        }}
        className={`${from === "sandbox" ? "max-w-full" : "block w-full flex-1"} cursor-grab rounded-md px-2 py-1 text-left text-sm shadow-sm active:cursor-grabbing ${
          on || dragging === id
            ? "bg-scenic-navy text-white ring-1 ring-scenic-navy"
            : today
              ? "bg-red-50 ring-2 ring-red-500 dark:bg-red-500/15"
              : before
                ? "bg-amber-50 ring-2 ring-amber-500 dark:bg-amber-500/15"
                : "bg-white ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/15"
        }`}
      >
        <span className="flex items-center gap-1 font-medium">
          {locked(id) && <span aria-label="Published">🔒</span>}
          <span className="min-w-0 break-words">{t ? <TeamName name={t.name} /> : "A removed team"}</span>
          <CoachBadge tag={t?.coach} />
        </span>
        <span className={`block text-[11px] ${on || dragging === id ? "text-white/80" : "text-zinc-500"}`}>
          {t && <LevelTag level={t.level} className="mr-1" />}
          {t?.group.replace(/ (REC|COMP)$/, "")}
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

  const flipHome = (g: Game) => {
    if (readOnly) return setNote({ tone: "red", lines: [VIEW_ONLY] });
    if (dirty || !g.id) return setNote({ tone: "red", lines: ["Save or undo your changes first, then switch home and away."] });
    // Shown at once (the home team on the left), saved behind it; put back if the save is refused.
    const before = games;
    setGames(games.map((x) => (x.key === g.key ? { ...x, a: x.b, b: x.a, home: "a" } : x)));
    announce([{ id: g.id, home: g.b, away: g.a }]); // the board shows the home team on the left
    start(async () => {
      const r = await switchHome(g.id!);
      if (!r.ok) {
        setGames(before);
        return setNote({ tone: "red", lines: [r.message] });
      }
      const home = g.home === "b" ? g.a : g.b;
      const away = g.home === "b" ? g.b : g.a;
      setNote({
        tone: "green",
        lines: [`${home ? `${team.get(home)?.name ?? "That team"} is home now` : `TBD is home now: ${team.get(away!)?.name ?? "the team"} visits`}.${r.placed ? " The game stays where it is on the Grid: move it to their gym if needed." : ""}`],
      });
      router.refresh();
    });
  };

  const save = (now: Game[] = games) =>
    start(async () => {
      // A game with one team plays TBD.
      const list = now.filter((g) => g.a || g.b).map((g) => [g.a ?? g.b!, g.a && g.b ? g.b : null] as [string, string | null]);
      const r = await saveMatchups(programId, day, divisionId, list);
      setNote(
        r.ok
          ? { tone: "green", lines: [`Saved ${r.saved} matchup${r.saved === 1 ? "" : "s"}.`] }
          : { tone: "red", lines: [r.message] },
      );
      if (r.ok) router.refresh();
    });

  // A division's REC and COMP matchups are created (and cleared) separately.
  const made = (l: string) => initial.some((g) => [g.a, g.b].some((id) => id && team.get(id)?.level === l));
  const create = async (level: string) => {
    if (
      made(level) &&
      !(await confirm({
        title: `Create ${division}'s ${level} matchups again?`,
        message: `The app pairs the ${level} teams again, replacing these ${level} matchups for this day.`,
        confirmLabel: "Create again",
      }))
    )
      return;
    setWorking(`create ${level}`);
    start(async () => {
      const r = await createMatchups(programId, day, divisionId, level);
      if (!r.ok) return setNote({ tone: "red", lines: [r.message] });
      setNote({
        tone: "green",
        lines: [
          `${r.created} ${level} matchup${r.created === 1 ? "" : "s"} created.`,
          ...r.tbd,
          ...r.short,
          ...r.repeats.map((x) => `Played before: ${x}`),
        ],
      });
      router.refresh();
    });
  };

  const fill = (g: Game, id: string | null) =>
    start(async () => {
      setNote(null);
      const r = await fillTbd(g.id!, id);
      if (!r.ok) return setNote({ tone: "red", lines: [r.message] });
      router.refresh();
    });
  // A game's level: its teams' (a fill-in's game: the team it fills in for). Games are grouped by it.
  const levelOf = (g: Pick<Game, "a" | "b" | "fill">) => team.get((g.fill ? (g.a === g.fill ? g.b : g.a) : (g.a ?? g.b)) ?? "")?.level ?? "REC";
  const has = (["REC", "COMP"] as const).filter((l) => teams.some((t) => t.level === l) || games.some((g) => levelOf(g) === l));
  // Clear: every matchup of that level here that isn't on the grid (or published).
  const clearable = (l: string) => (published.includes(l) ? 0 : initial.filter((g) => !g.placed && levelOf(g) === l).length);
  const clear = async (level: string) => {
    const n = clearable(level);
    const onGrid = initial.filter((g) => g.placed && levelOf(g) === level).length;
    if (
      !(await confirm({
        title: `Clear ${division}'s ${level} matchups for this day?`,
        message: `${n} ${level} matchup${n === 1 ? "" : "s"} not on the schedule grid ${n === 1 ? "is" : "are"} cleared; the teams go back to the Sandbox.${onGrid ? ` ${onGrid} already on the grid stay${onGrid === 1 ? "s" : ""}.` : ""}`,
        confirmLabel: `Clear ${level} matchups`,
      }))
    )
      return;
    setWorking(`clear ${level}`);
    start(async () => {
      setNote(null);
      const r = await clearMatchups(programId, day, divisionId, level);
      if (!r.ok) return setNote({ tone: "red", lines: [r.message] });
      setNote({ tone: "green", lines: [`${r.cleared} ${level} matchup${r.cleared === 1 ? "" : "s"} cleared${r.kept ? `; ${r.kept} stayed (on the grid or published)` : ""}.`] });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {published.length > 0 && teams.some((t) => locked(t.id)) && (
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">🔒 {published.join(" and ")} published: those games stay as they are until you unpublish them.</p>
      )}
      <p className="text-xs text-zinc-500">
        Drag a team to change a matchup (or tap it, then tap where it goes); each change is saved at once and shows on the Grid. Drop on a team to swap them; on the other side of its own game (its opponent or TBD) to switch home and away. While you drag, teams it
        already plays light up: <span className="font-semibold text-amber-700 dark:text-amber-300">amber</span> on another Game
        Day, <span className="font-semibold text-red-600 dark:text-red-400">red</span> today.
      </p>
      {has.map((level) => {
        const list = games.filter((g) => levelOf(g) === level);
        return (
      <section key={level} className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <LevelTag level={level} />
        <span className="font-normal text-zinc-500">
          {list.length} matchup{list.length === 1 ? "" : "s"}
        </span>
      </h4>
      <ul className="space-y-1">
        {list.map((g) => {
          const met = g.a && g.b ? otherDays[pairKey(g.a, g.b)] : undefined;
          const twice = (g.a || g.b) && dupes.has(gameKey(g));
          const one = !g.a !== !g.b; // one team: plays TBD
          const wrong = g.wrong;
          const mixed = !wrong && g.a && g.b && !g.fill && team.get(g.a)?.level !== team.get(g.b)?.level;
          return (
            <li key={g.key} className={`rounded-lg p-1 ${wrong ? "bg-red-50 ring-1 ring-red-300 dark:bg-red-500/10" : "bg-zinc-50 dark:bg-white/5"}`}>
              {/* A tag only when something needs attention: REC against COMP (an old game: no longer allowed), the pair meets on another Game Day, or twice today. */}
              {wrong && <p className="mb-1 px-1 text-[11px] font-semibold text-red-700 dark:text-red-300">⚠ To correct: {wrong}</p>}
              {(met || twice || mixed) && (
                <div className="mb-0.5 flex justify-end gap-2 px-1 text-[11px]">
                  {mixed && (
                    <span className="rounded-full bg-red-100 px-1.5 font-semibold text-red-800 dark:bg-red-500/15 dark:text-red-300">
                      REC vs COMP: not allowed, change it
                    </span>
                  )}
                  {met && (
                    <span className="rounded-full bg-amber-100 px-1.5 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                      Also {met.map(shortDay).join(", ")}
                    </span>
                  )}
                  {twice && (
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      {one ? "TBD twice" : "Same matchup twice"}
                    </span>
                  )}
                </div>
              )}
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-1.5">
                {(["a", "b"] as const).map((side, j) => {
                  const id = `${g.key}:${side}`;
                  const who = g[side];
                  return (
                    <div key={side} className="contents">
                      {j === 1 && <span className="self-center text-xs font-semibold text-zinc-400">vs</span>}
                      <div {...dropProps(id)} className={`relative flex min-h-10 min-w-0 flex-col rounded-md p-0.5 ${ring(id)}`}>
                        {who ? (
                          chip(who, id)
                        ) : one && g.id && g.tbd && !dirty && !gameLocked(g) && !busy ? (
                          <FillPicker team={(g.a ?? g.b)!} teams={everyone} division={division} games={games} fills={fills} otherDays={otherDays} onPick={(id) => fill(g, id)} />
                        ) : one && !gameLocked(g) && !busy ? (
                          // Not saved yet: pick one of this division's teams to play here (moved in, as if dropped; then Save).
                          <span className="block px-1 py-1 text-center text-xs">
                            <span className="font-semibold text-zinc-600 dark:text-zinc-300">TBD</span>
                            <select
                              aria-label="A team to play here"
                              onClick={(e) => e.stopPropagation()}
                              value=""
                              onChange={(e) => {
                                const pickTeam = e.target.value;
                                if (!pickTeam) return;
                                const inGame = games.find((x) => x.a === pickTeam || x.b === pickTeam);
                                act({ team: pickTeam, from: inGame ? `${inGame.key}:${inGame.a === pickTeam ? "a" : "b"}` : "sandbox" }, id);
                              }}
                              className={pickCls}
                            >
                              <option value="">Pick a team…</option>
                              {teams
                                .filter((x) => x.id !== (g.a ?? g.b) && x.level === team.get((g.a ?? g.b)!)?.level)
                                .map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.name}
                                    {placed(x.id) < x.need ? " · in the Sandbox" : ""}
                                  </option>
                                ))}
                            </select>
                          </span>
                        ) : one ? (
                          <span className="block px-1 py-1 text-center text-xs">
                            <span className="font-semibold text-zinc-600 dark:text-zinc-300">TBD</span>
                            <span className="block text-[11px] text-zinc-400">Drop an opponent</span>
                          </span>
                        ) : (
                          <span className="block px-1 py-2 text-center text-xs text-zinc-400">Drop an opponent</span>
                        )}
                        {who && g.fill === who && (
                          <span className="mt-0.5 flex items-center justify-between gap-1 px-1 text-[11px] text-violet-700 dark:text-violet-300">
                            Extra game
                            {g.id && !dirty && !gameLocked(g) && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  fill(g, null);
                                }}
                                className="font-semibold text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                              >
                                Back to TBD
                              </button>
                            )}
                          </span>
                        )}
                        {g.home === side && (
                          <span
                            title="Home team"
                            className="pointer-events-none absolute -top-1.5 -right-1 rounded-full bg-emerald-600 px-1.5 text-[10px] leading-4 font-bold text-white"
                          >
                            H
                          </span>
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
      {!dirty && !readOnly && !published.includes(level) && (
        <div className="flex flex-col gap-2">
          {teams.some((x) => x.level === level) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => create(level)}
              className="flex-1 rounded-lg bg-scenic-navy px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {busy && working === `create ${level}` ? "Working…" : `Create ${level} matchups${made(level) ? " again" : ""}`}
            </button>
          )}
          {clearable(level) > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => clear(level)}
              className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              {busy && working === `clear ${level}` ? "Working…" : `Clear ${level} matchups (${clearable(level)})`}
            </button>
          )}
        </div>
      )}
      </section>
        );
      })}
      <div
        {...dropProps("new")}
        className={`rounded-xl border border-dashed border-zinc-300 p-2 text-center text-xs text-zinc-500 dark:border-white/20 ${ring("new")}`}
      >
        {manual ? (
          <NewGame
            teams={teams}
            everyone={everyone}
            division={division}
            published={published}
            fills={fills}
            games={games}
            otherDays={otherDays}
            busy={busy}
            onCancel={() => setManual(false)}
            onAdd={(a, b) =>
              start(async () => {
                setNote(null);
                const r = await addGame(programId, day, divisionId, a, b);
                if (!r.ok) return setNote({ tone: "red", lines: [r.message] });
                setManual(false);
                router.refresh();
              })
            }
          />
        ) : (
          "+ Drop a team, or TBD, here to start a new game"
        )}
      </div>
      <section {...dropProps("sandbox")} className={`rounded-xl p-2 ${ring("sandbox")} bg-amber-50/50 dark:bg-amber-500/5`}>
        <h4 className="mb-1.5 flex items-baseline justify-between text-sm font-semibold">
          Sandbox
          <span className="text-xs font-normal text-zinc-500">Teams not in a matchup</span>
        </h4>
        {/* TBD: drag (or tap) it into the New game box for a game across levels, grades or divisions. */}
        <button
          type="button"
          draggable={!readOnly}
          onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ team: TBD, from: "sandbox" }))}
          onClick={(e) => {
            e.stopPropagation();
            setPicked(picked?.team === TBD ? null : { team: TBD, from: "sandbox" });
          }}
          className={`mb-1.5 cursor-grab rounded-md border border-dashed px-3 py-1 text-sm font-semibold active:cursor-grabbing ${picked?.team === TBD ? "border-scenic-navy bg-scenic-navy text-white" : "border-zinc-400 bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"}`}
        >
          TBD
        </button>
        {sandbox.length ? (
          <div className="space-y-2">
          {has.filter((l) => sandbox.some((x) => x.level === l)).map((l) => (
          <div key={l} className="flex flex-wrap gap-1.5">
            {sandbox.filter((x) => x.level === l).map((t) => (
              <div key={t.id} className="flex max-w-full min-w-0 items-center gap-1">
                {chip(t.id, "sandbox")}
                {t.need - placed(t.id) > 1 && <span className="text-[11px] text-zinc-500">×{t.need - placed(t.id)}</span>}
              </div>
            ))}
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
              onClick={() => save()}
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
      </div>
      {dirty && games.some((g) => !g.a || !g.b) && (
        <p className="text-xs text-zinc-500">A game with one team is saved against TBD.</p>
      )}
      {dialog}
    </div>
  );
}

// The teams a game against `team` can be filled in with: any level, grade or division. Its own division first (its level, then the
// other), then the rest by division; teams that already filled in for a TBD last, saying when. Not teams it already plays that day.
function TeamOptions({
  team,
  teams,
  division,
  games,
  fills,
  otherDays,
}: {
  team: string | null;
  teams: BoardTeam[];
  division: string;
  games: Game[];
  fills: Record<string, string[]>;
  otherDays: Record<string, string[]>;
}) {
  const me = teams.find((t) => t.id === team);
  const plays = (id: string) => games.some((g) => (g.a === team && g.b === id) || (g.a === id && g.b === team));
  // Who can fill in: the same gender (a Coed division plays either), a grade above or below at most, REC or COMP, and never a team
  // it already plays (today or another Game Day). The server checks it again.
  const fits = (t: BoardTeam) =>
    !me ||
    ((t.gender === me.gender || t.gender === "Coed" || me.gender === "Coed") &&
      Math.abs((t.grade ?? 0) - (me.grade ?? 0)) <= 1 &&
      !otherDays[pairKey(me.id, t.id)]);
  const list = teams.filter((t) => t.id !== team && !plays(t.id) && fits(t)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const used = list.filter((t) => fills[t.id]?.length);
  const fresh = list.filter((t) => !fills[t.id]?.length);
  const own = me?.level ?? "REC";
  const groups = new Map<string, BoardTeam[]>();
  for (const t of fresh) groups.set(`${t.division} ${t.level}`, [...(groups.get(`${t.division} ${t.level}`) ?? []), t]);
  const rank = (k: string) => (k === `${division} ${own}` ? 0 : k.startsWith(`${division} `) ? 1 : 2);
  const order = [...groups.keys()].map((k) => ({ k, i: teams.findIndex((t) => `${t.division} ${t.level}` === k) })).sort((x, y) => rank(x.k) - rank(y.k) || x.i - y.i || 0);
  const option = (t: BoardTeam, note = "") => {
    const met = team ? otherDays[pairKey(team, t.id)] : undefined;
    return (
      <option key={t.id} value={t.id}>
        {t.name} ({t.level}){met ? ` · plays them ${met.map(shortDay).join(", ")}` : ""}
        {note}
      </option>
    );
  };
  return (
    <>
      {order.map(({ k }) => (
        <optgroup key={k} label={k}>
          {groups.get(k)!.map((t) => option(t))}
        </optgroup>
      ))}
      {used.length > 0 && (
        <optgroup label="Already filled in for a TBD">{used.map((t) => option(t, ` · ${t.division} · filled in ${fills[t.id].map(shortDay).join(", ")}`))}</optgroup>
      )}
    </>
  );
}

const pickCls = "mt-0.5 block w-full min-w-0 rounded-md bg-white px-1 py-1 text-xs ring-1 ring-zinc-950/15 dark:bg-zinc-900 dark:ring-white/15";

// A TBD's slot: pick a team to play an extra game.
function FillPicker({ onPick, ...p }: Omit<Parameters<typeof TeamOptions>[0], "team"> & { team: string; onPick: (id: string) => void }) {
  return (
    // Only the list catches a tap: the rest of the box still takes a team (its own team: home and away switch).
    <span className="block px-1 py-1 text-center text-xs">
      <span className="font-semibold text-zinc-600 dark:text-zinc-300">TBD</span>
      <select onClick={(e) => e.stopPropagation()} aria-label={`A team to play ${p.teams.find((t) => t.id === p.team)?.name ?? "this team"}`} value="" onChange={(e) => e.target.value && onPick(e.target.value)} className={pickCls}>
        <option value="">Pick a team…</option>
        <TeamOptions {...p} />
      </select>
    </span>
  );
}

// A game made by hand (TBD in the New game box): a team of this division, against any team playing that day (or TBD for now).
function NewGame({
  teams,
  everyone,
  published,
  busy,
  onAdd,
  onCancel,
  ...rest
}: Omit<Parameters<typeof TeamOptions>[0], "team" | "teams"> & {
  teams: BoardTeam[];
  everyone: BoardTeam[];
  published: string[];
  busy: boolean;
  onAdd: (a: string, b: string | null) => void;
  onCancel: () => void;
}) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const mine = teams.filter((t) => !published.includes(t.level));
  return (
    <div className="space-y-2 text-left" onClick={(e) => e.stopPropagation()}>
      <p className="font-semibold text-zinc-700 dark:text-zinc-200">New game, any level, grade or division</p>
      <label className="block">
        {rest.division} team
        <select value={a} onChange={(e) => (setA(e.target.value), setB(""))} className={pickCls}>
          <option value="">Pick a team…</option>
          {(["REC", "COMP"] as const).map((l) => {
            const of = mine.filter((t) => t.level === l);
            return (
              of.length > 0 && (
                <optgroup key={l} label={l}>
                  {of.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              )
            );
          })}
        </select>
      </label>
      <label className="block">
        Against
        <select value={b} disabled={!a} onChange={(e) => setB(e.target.value)} className={`${pickCls} disabled:opacity-50`}>
          <option value="">TBD for now</option>
          {a && <TeamOptions {...rest} team={a} teams={everyone} />}
        </select>
      </label>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy || !a} onClick={() => onAdd(a, b || null)} className="rounded-lg bg-scenic-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? "Adding…" : "Add the game"}
        </button>
        <button type="button" onClick={onCancel} className="text-xs font-medium text-zinc-500">
          Cancel
        </button>
      </div>
    </div>
  );
}
