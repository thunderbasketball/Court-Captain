"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardDay, BoardGame, BoardOfficial, OfficialsBoard } from "@/lib/officiating-schedule";
import { TZ } from "@/lib/time";
import { useTouchDrag } from "../touch-drag";
import { assignOfficialAction, removeOfficialFromAction } from "./actions";

const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const LEVEL_TAG: Record<string, string> = { Certified: "C", Experienced: "E", Student: "S" };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const chevron = (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className="size-5 shrink-0 text-zinc-400 transition-transform [details[open]>summary_&]:rotate-180">
    <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
  </svg>
);

// What's being moved: an official from the available list, or one already in a game's spot.
type Moving = { officialId: string; from: { gameId: string; position: number } | null };
const encode = (m: Moving) => (m.from ? `${m.officialId}:${m.from.gameId}:${m.from.position}` : m.officialId);
const decode = (s: string): Moving | null => {
  const [officialId, gameId, position] = s.split(":");
  if (!/^\d{7}$/.test(officialId ?? "")) return null;
  return { officialId, from: gameId ? { gameId, position: Number(position) } : null };
};

// Games to officiate (an Officials Group's Admins and Officials Assigners): a card per day with games (open referee spots
// flash it), a card per gym inside. A gym card opens to its Available officials (Recruits aren't listed) and each game's
// 2 referee spots: drag an official into a spot (on a phone, press and hold, then slide), or tap an official then a spot.
// Drag one from a spot back to Available officials (or tap ✕) to take them off. An official already on a game then
// can't go on another; the server checks everything again.
export function GamesToOfficiate({ org, board: fromServer }: { org: string; board: OfficialsBoard }) {
  const router = useRouter();
  // Changes show at once (the name lands in the spot as it's dropped); the server's answer then replaces them, or puts
  // them back with its reason.
  const [seen, setSeen] = useState(fromServer);
  const [board, setBoard] = useState(fromServer);
  // Changes still saving: taps never wait for them, and the server's board replaces this one once all are saved.
  const [saving, setSaving] = useState(0);
  if (fromServer !== seen && saving === 0) {
    setSeen(fromServer);
    setBoard(fromServer);
  }
  const [picked, setPicked] = useState<Moving | null>(null);
  const [dragging, setDragging] = useState<Moving | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The official just put in a spot: the next game in that gym offers "+ Add" in the same spot.
  const [last, setLast] = useState<{ officialId: string; gameId: string; position: number } | null>(null);
  // ✕ on an official who is also in the same spot on the games right after in this gym: asks whether to take them off
  // those too.
  const [removing, setRemoving] = useState<{ gameId: string; name: string; officialId: string; next: string[] } | null>(null);
  // Save one change in the background (they go to the server in order).
  const save = (fn: () => Promise<{ ok: boolean; message?: string }>, undo: () => void) => {
    setSaving((n) => n + 1);
    void fn()
      .then((r) => {
        if (!r.ok) {
          setError(r.message ?? "Something went wrong. Please try again.");
          undo();
        }
      })
      .catch(() => {
        setError("Something went wrong. Please try again.");
        undo();
      })
      .finally(() => {
        setSaving((n) => n - 1);
        router.refresh();
      });
  };
  const active = dragging ?? picked;
  const names = new Map(board.officials.map((o) => [o.id, `${o.first} ${o.last}`]));
  // Why the official being moved can't go in this game: already on it, or on another game at that time.
  const blocked = (g: BoardGame): string | null => {
    if (!active) return null;
    if (g.started) return "Started";
    if (g.spots.some((s) => s.official?.id === active.officialId && s.position !== (active.from?.gameId === g.id ? active.from.position : -1)))
      return "Already on it";
    const clash = (board.busy[active.officialId] ?? []).some(
      (b) => b.gameId !== g.id && b.gameId !== active.from?.gameId && b.start < g.end && g.start < b.end,
    );
    return clash ? "On a game then" : null;
  };
  // The games right after this one in the gym with the same official in the same spot, in a row.
  const runAfter = (games: BoardGame[], gameId: string, position: number, officialId: string) => {
    const out: string[] = [];
    for (const g of games.slice(games.findIndex((x) => x.id === gameId) + 1)) {
      if (g.started || g.spots.find((x) => x.position === position)?.official?.id !== officialId) break;
      out.push(g.id);
    }
    return out;
  };
  const removeFrom = (officialId: string, gameIds: string[]) => {
    setRemoving(null);
    setLast(null);
    setError(null);
    setBoard((b) => gameIds.reduce((x, id) => takenOff(x, officialId, id), b));
    save(
      () => removeOfficialFromAction(org, officialId, gameIds),
      () => setBoard(fromServer),
    );
  };
  // The next game in this gym after the one just filled, when its same spot is open and the official is free then.
  const offerFor = (games: BoardGame[]): { gameId: string; position: number; officialId: string } | null => {
    if (!last || active) return null;
    const i = games.findIndex((g) => g.id === last.gameId);
    const next = i >= 0 ? games[i + 1] : undefined;
    if (!next || next.started || next.spots.find((x) => x.position === last.position)?.official) return null;
    if (next.spots.some((x) => x.official?.id === last.officialId)) return null;
    const busy = (board.busy[last.officialId] ?? []).some((b) => b.gameId !== next.id && b.start < next.end && next.start < b.end);
    const prev = games[i];
    const overlapsLast = prev.start < next.end && next.start < prev.end; // the game just filled (until the page refreshes)
    return busy || overlapsLast ? null : { gameId: next.id, position: last.position, officialId: last.officialId };
  };

  function place(m: Moving, gameId: string | null, position: number | null) {
    setPicked(null);
    setDragging(null);
    setOver(null);
    setError(null);
    setBoard((b) => moved(b, m, gameId, position));
    setLast(gameId && position ? { officialId: m.officialId, gameId, position } : null);
    save(
      () =>
        gameId && position
          ? assignOfficialAction(org, { gameId, position, officialId: m.officialId, from: m.from })
          : m.from
            ? assignOfficialAction(org, { gameId: m.from.gameId, position: m.from.position, officialId: null })
            : Promise.resolve({ ok: true }),
      () => {
        setBoard(fromServer); // back as it was
        setLast(null);
      },
    );
  }

  const keyOf = (key: string | null): { gameId: string; position: number } | null | undefined => {
    if (!key) return undefined;
    if (key.startsWith("pool")) return null;
    const [, gameId, position] = key.split(":");
    return { gameId, position: Number(position) };
  };
  const touch = useTouchDrag({
    onStart: (data) => {
      setPicked(null);
      setDragging(decode(data));
    },
    onOver: (key) => setOver(key),
    onDrop: (data, key) => {
      const m = decode(data);
      const to = keyOf(key);
      setDragging(null);
      if (!m || to === undefined) return;
      place(m, to?.gameId ?? null, to?.position ?? null);
    },
    onCancel: () => setDragging(null),
  });
  const target = (key: string, to: { gameId: string; position: number } | null, disabled: boolean) => ({
    "data-drop": disabled ? undefined : key,
    onDragOver: (e: React.DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      const m = decode(e.dataTransfer.getData("text/plain"));
      if (m && !disabled) place(m, to?.gameId ?? null, to?.position ?? null);
    },
    onClick: () => {
      if (touch.justDropped() || !picked || disabled) return;
      place(picked, to?.gameId ?? null, to?.position ?? null);
    },
  });
  const chip = (m: Moving, label: string, sub: string | null, extra = "") => {
    const on = active?.officialId === m.officialId && active?.from?.gameId === m.from?.gameId && active?.from?.position === m.from?.position;
    return (
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", encode(m));
          setPicked(null);
          setDragging(m);
        }}
        onDragEnd={() => setDragging(null)}
        {...touch.source(encode(m), label)}
        onClick={(e) => {
          e.stopPropagation();
          if (touch.justDropped()) return;
          setPicked(on ? null : m);
        }}
        className={`max-w-full cursor-grab touch-manipulation rounded-md px-2 py-1 text-left text-xs shadow-sm ring-1 select-none [-webkit-touch-callout:none] active:cursor-grabbing ${
          on ? "bg-scenic-navy text-white ring-scenic-navy" : "bg-white ring-zinc-950/10 dark:bg-zinc-800 dark:ring-white/15"
        } ${extra}`}
      >
        <span className="font-semibold">{label}</span>
        {sub && <span className={on ? "text-white/80" : "text-zinc-500"}> {sub}</span>}
      </button>
    );
  };
  const ring = (key: string, why: string | null) =>
    over === key
      ? "bg-sky-50 ring-2 ring-scenic-navy dark:bg-sky-500/10 dark:ring-white"
      : why
        ? "bg-red-50 ring-1 ring-red-300 dark:bg-red-500/10 dark:ring-red-400/40"
        : active
          ? "ring-1 ring-scenic-navy/40 dark:ring-white/40"
          : "ring-1 ring-zinc-950/10 dark:ring-white/15";

  if (!board.days.length)
    return <p className="text-sm text-zinc-500">No games to officiate yet. They show here when an organization picks your group.</p>;
  return (
    <div className="space-y-3">
      {touch.ghost}
      <p className="text-sm text-zinc-500">
        Open a gym, then drag an official into a game&apos;s spot (on a phone: press and hold, then slide), or tap an official and then a
        spot. Drag one back to Available officials to take them off. After you place one, the next game in that gym offers{" "}
        <span className="font-semibold text-emerald-700 dark:text-emerald-400">+ Add</span> them in the same spot.{" "}
        {!board.officials.length && <span className="text-red-600 dark:text-red-400">No officials who can be scheduled yet (Recruits can&apos;t).</span>}
      </p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
      {board.days.map((d) => (
        <Day key={d.date} d={d}>
          {d.gyms.map((g) => (
            <details key={g.key} className="group/gym overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{g.place}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {g.orgName}
                    {g.address && ` · ${g.address}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  <span className="text-zinc-500">{plural(g.games.length, "game")}</span>
                  {g.open > 0 ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                      {g.open} open
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                      Full
                    </span>
                  )}
                  {chevron}
                </span>
              </summary>
              <div className="space-y-3 border-t border-zinc-100 p-3 dark:border-white/5">
                <Pool officials={board.officials} day={d} gymGames={g.games} chip={chip} dropProps={target(`pool:${g.key}`, null, false)} cls={ring(`pool:${g.key}`, null)} />
                <ul className="space-y-2">
                  {g.games.map((x) => {
                    const why = blocked(x);
                    const offer = offerFor(g.games);
                    return (
                      <li key={x.id} className={`rounded-lg bg-zinc-50 p-2 dark:bg-white/5 ${x.started ? "opacity-60" : ""}`}>
                        <p className="text-sm">
                          <span className="font-semibold">
                            {time(x.start)}–{time(x.end)}
                          </span>{" "}
                          {x.kind !== "League" && (
                            <span className="mr-1 rounded bg-orange-100 px-1 text-[10px] font-bold text-orange-800 uppercase dark:bg-orange-500/15 dark:text-orange-300">
                              {x.kind}
                            </span>
                          )}
                          {x.home} vs {x.away}
                        </p>
                        <div className="mt-1.5 grid grid-cols-2 gap-2">
                          {x.spots.map((s) => {
                            const key = `spot:${x.id}:${s.position}`;
                            const self = active?.from?.gameId === x.id && active.from.position === s.position;
                            const stop = self ? null : why;
                            return (
                              <div
                                key={s.position}
                                {...target(key, { gameId: x.id, position: s.position }, !!stop || x.started)}
                                className={`flex min-h-10 items-center gap-1 rounded-md p-1 ${ring(key, stop)}`}
                              >
                                {s.official ? (
                                  <>
                                    {chip(
                                      { officialId: s.official.id, from: { gameId: x.id, position: s.position } },
                                      names.get(s.official.id) ?? s.official.name,
                                      null,
                                      "min-w-0 flex-1 truncate",
                                    )}
                                    {!x.started && (
                                      <button
                                        type="button"
                                        aria-label={`Take ${s.official.name} off`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const next = runAfter(g.games, x.id, s.position, s.official!.id);
                                          if (next.length)
                                            setRemoving({ gameId: x.id, officialId: s.official!.id, name: s.official!.name, next });
                                          else place({ officialId: s.official!.id, from: { gameId: x.id, position: s.position } }, null, null);
                                        }}
                                        className="px-1 text-xs text-zinc-400 hover:text-red-600"
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </>
                                ) : offer && offer.gameId === x.id && offer.position === s.position ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      place({ officialId: offer.officialId, from: null }, x.id, s.position);
                                    }}
                                    className="w-full animate-pulse rounded-md bg-emerald-50 px-2 py-1 text-left text-xs font-semibold text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/40"
                                  >
                                    + Add {names.get(offer.officialId) ?? "them"}
                                  </button>
                                ) : (
                                  <span className={`px-1 text-xs ${stop ? "text-red-600 dark:text-red-400" : "text-zinc-400"}`}>
                                    {stop ?? `Referee ${s.position}`}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {removing?.gameId === x.id && (
                          <div className="mt-2 space-y-2 rounded-lg bg-white p-2 text-xs ring-1 ring-red-200 dark:bg-zinc-900 dark:ring-red-400/30">
                            <p>
                              {removing.name} is also on the next {plural(removing.next.length, "game")} in this spot. Take them off those too?
                            </p>
                            <div className="flex flex-wrap justify-end gap-2">
                              <button type="button" onClick={() => setRemoving(null)} className="rounded-full px-2.5 py-1 ring-1 ring-zinc-950/10 dark:ring-white/15">
                                Keep
                              </button>
                              <button
                                type="button"
                                onClick={() => removeFrom(removing.officialId, [removing.gameId])}
                                className="rounded-full px-2.5 py-1 font-semibold text-red-600 ring-1 ring-red-300 dark:text-red-400"
                              >
                                Just this game
                              </button>
                              <button
                                type="button"
                                onClick={() => removeFrom(removing.officialId, [removing.gameId, ...removing.next])}
                                className="rounded-full bg-red-600 px-2.5 py-1 font-semibold text-white disabled:opacity-50"
                              >
                                This and the next {removing.next.length}
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          ))}
        </Day>
      ))}
    </div>
  );
}

// A day's card: its games and open spots (flashing while any are open), the gyms inside.
function Day({ d, children }: { d: BoardDay; children: React.ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-2xl bg-zinc-50 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:ring-white/10">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className={`font-semibold ${d.open ? "animate-pulse text-red-600 dark:text-red-400" : ""}`}>{dayLabel(d.date)}</span>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          {plural(d.games, "game")} · {d.open ? `${d.open} open` : "all set"}
          {chevron}
        </span>
      </summary>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </details>
  );
}

// Available officials (a drop area too: drop one from a spot here to take them off), each with their level and how many
// games they have that day.
function Pool({
  officials,
  day,
  gymGames,
  chip,
  dropProps,
  cls,
}: {
  officials: BoardOfficial[];
  day: BoardDay;
  gymGames: BoardGame[];
  chip: (m: Moving, label: string, sub: string | null) => React.ReactNode;
  dropProps: object;
  cls: string;
}) {
  const today = new Map<string, number>();
  for (const g of day.gyms) for (const x of g.games) for (const s of x.spots) if (s.official) today.set(s.official.id, (today.get(s.official.id) ?? 0) + 1);
  const here = new Set(gymGames.flatMap((x) => x.spots.flatMap((s) => (s.official ? [s.official.id] : []))));
  return (
    <div {...dropProps} className={`rounded-lg p-2 ${cls}`}>
      <p className="mb-1.5 text-xs font-semibold text-zinc-500">Available officials ({officials.length})</p>
      {!officials.length ? (
        <p className="text-xs text-zinc-400">None yet.</p>
      ) : (
        <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
          {officials.map((o) => (
            <span key={o.id} className={here.has(o.id) ? "opacity-60" : ""}>
              {chip(
                { officialId: o.id, from: null },
                `${o.first} ${o.last}`,
                [o.level ? LEVEL_TAG[o.level] : null, today.get(o.id) ? `· ${today.get(o.id)} today` : null].filter(Boolean).join(" ") || null,
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Showing a change at once (before the server answers) ----

// The board with every spot, open count and busy time recounted after `change` edits the games' spots.
function withSpots(b: OfficialsBoard, change: (g: BoardGame) => BoardGame): OfficialsBoard {
  const days = b.days.map((d) => {
    const gyms = d.gyms.map((g) => {
      const games = g.games.map(change);
      return { ...g, games, open: games.reduce((n, x) => n + x.spots.filter((s) => !s.official).length, 0) };
    });
    return { ...d, gyms, open: gyms.reduce((n, g) => n + g.open, 0) };
  });
  // Busy times: the games outside this board stay; this board's are read from its spots.
  const here = new Set(days.flatMap((d) => d.gyms.flatMap((g) => g.games.map((x) => x.id))));
  const busy: OfficialsBoard["busy"] = {};
  for (const [id, list] of Object.entries(b.busy)) busy[id] = list.filter((t) => !here.has(t.gameId));
  for (const d of days)
    for (const g of d.gyms)
      for (const x of g.games)
        for (const s of x.spots) if (s.official) (busy[s.official.id] ??= []).push({ gameId: x.id, start: x.start, end: x.end });
  return { ...b, days, busy, open: days.reduce((n, d) => n + d.open, 0) };
}

// An official taken off one game.
function takenOff(b: OfficialsBoard, officialId: string, gameId: string): OfficialsBoard {
  return withSpots(b, (x) =>
    x.id !== gameId ? x : { ...x, spots: x.spots.map((s) => (s.official?.id === officialId ? { ...s, official: null, assignedBy: null } : s)) },
  );
}

// An official put in a spot (out of the one they came from), or taken off (no spot).
function moved(b: OfficialsBoard, m: Moving, gameId: string | null, position: number | null): OfficialsBoard {
  const o = b.officials.find((x) => x.id === m.officialId);
  const name = o ? `${o.first} ${o.last}` : "";
  return withSpots(b, (x) => ({
    ...x,
    spots: x.spots.map((s) => {
      if (x.id === gameId && s.position === position) return { ...s, official: { id: m.officialId, name }, assignedBy: null };
      if (m.from && x.id === m.from.gameId && s.position === m.from.position) return { ...s, official: null, assignedBy: null };
      return s;
    }),
  }));
}
