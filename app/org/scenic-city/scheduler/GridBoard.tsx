"use client";

import { CoachBadge, LevelTag, TeamName, type CoachTag } from "../../../ui";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "../../../client-ui";
import { placeGame } from "../actions";
import { useTouchDrag } from "../../../touch-drag";

export type GridTeam = {
  id: string;
  name: string;
  partnerId: string | null;
  group: string;
  division: string;
  from: string;
  grade: number; // its grade group's grade, for sorting youngest first
  level: string; // REC or COMP
  coach?: CoachTag; // its coach has another team playing that day
  people?: string[]; // its coaches (Head and Assistant): one person is never at two games at once
};
export type GridGame = {
  id: string;
  divisionId: string;
  home: GridTeam | null; // the home team: the game belongs at its school's or organization's gym (null: TBD)
  away: GridTeam | null; // null: TBD (one of the two is always a team)
  league: string | null;
  court: string | null;
  starts: string | null;
};
export type GridGymView = {
  key: string;
  name: string;
  host: string;
  hostId: string;
  address: string | null;
  opens: string;
  closes: string;
  courts: { id: string; name: string; starts: string; ends: string; divisions: string[] | null }[]; // divisions: only these (null: any)
  blocks: [string, string][];
};

// Boys' games blue, Girls' pink, Coed (Pre-K) lime (the division name starts with the gender).
const genderCls = (x: GridGame) => {
  const d = (x.home ?? x.away)!.division;
  return d.startsWith("Girls")
    ? "bg-pink-50 ring-pink-300 dark:bg-pink-500/15 dark:ring-pink-400/40"
    : d.startsWith("Coed")
      ? "bg-lime-50 ring-lime-400 dark:bg-lime-500/15 dark:ring-lime-400/40"
      : "bg-sky-50 ring-sky-300 dark:bg-sky-500/15 dark:ring-sky-400/40";
};
// The game's level: REC or COMP, or both (orange) when a REC team plays a COMP team.
function GameLevel({ x }: { x: GridGame }) {
  const levels = [...new Set([x.home, x.away].flatMap((t) => (t ? [t.level] : [])))];
  if (levels.length === 1) return <LevelTag level={levels[0]} />;
  return <span className="inline-block rounded bg-orange-500 px-1 text-[10px] leading-4 font-bold text-white">REC/COMP</span>;
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const label = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// The Grid's gyms, each collapsed (host, hours, courts, open slots). Expanded: a game slot per court and block. Drag a
// game (or tap it, then tap where it goes) from the gym's selection area (its home games not yet placed; when none,
// the games with no home gym) into an open slot, between slots, or back to a selection area to take it off the grid.
// Each move is saved at once, and checked on the server (open, free, neither team already playing then).
export function GridBoard({
  day,
  gyms,
  games: initial,
  minutes,
  divisions,
}: {
  day: string; // YYYY-MM-DD: the Game Day (for its gyms' printable scoresheets)
  gyms: GridGymView[];
  games: GridGame[];
  minutes: number;
  divisions: Record<string, string>; // division id → "Boys 3rd–4th"
}) {
  const router = useRouter();
  const [games, setGames] = useState(initial);
  // After a save the page refreshes with the server's games: take them in without starting over, so open gyms stay
  // open.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setGames(initial);
  }
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  // Shift-click (or Cmd/Ctrl-click) picks several games to move together.
  const [selected, setSelected] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const active = dragging ?? picked ?? selected[0] ?? null;
  const hosts = new Set(gyms.map((g) => g.hostId));
  const courts = new Map(gyms.flatMap((g) => g.courts.map((c) => [c.id, { ...c, gym: g }] as const)));
  // On the grid: a court of an open gym at one of its block times (a game left off by a new game length isn't).
  const onGrid = (x: GridGame) => !!x.court && !!x.starts && !!courts.get(x.court)?.gym.blocks.some(([s]) => s === x.starts);
  const homeless = (x: GridGame) => !hosts.has(x.home?.partnerId ?? "");
  const isHome = (x: GridGame, hostId: string) => !!x.home && x.home.partnerId === hostId;
  // The court takes this game's division (Facilities → Courts; a court with none set takes any).
  const fits = (x: GridGame, court: string) => {
    const d = courts.get(court)?.divisions;
    return !d || d.includes(x.divisionId);
  };
  // Each game lasts its slot's length (Custom times can mix lengths); two games overlap when their times cross.
  const lengths = new Map(gyms.flatMap((g) => g.blocks.map(([b, e]) => [b, toMin(e) - toMin(b)] as const)));
  const lenOf = (s: string) => lengths.get(s) ?? minutes;
  const overlaps = (a: string, b: string) => toMin(a) < toMin(b) + lenOf(b) && toMin(b) < toMin(a) + lenOf(a);
  const at = (court: string, s: string) => games.find((x) => x.court === court && x.starts === s && onGrid(x));
  const ids = (x: GridGame) => [x.home, x.away].flatMap((t) => (t ? [t.id] : []));
  const people = (x: GridGame) => [x.home, x.away].flatMap((t) => t?.people ?? []);
  const sharesTeam = (x: GridGame, y: GridGame) => ids(x).some((n) => ids(y).includes(n));
  const sharesCoach = (x: GridGame, y: GridGame) => people(x).some((n) => people(y).includes(n));
  const shares = (x: GridGame, y: GridGame) => sharesTeam(x, y) || sharesCoach(x, y);
  // Why the game being moved can't start then: one of its teams, or one of its coaches (Head or Assistant), already
  // has a game within a game length of this time.
  const busy = (s: string): "team" | "coach" | null => {
    const g = active && games.find((x) => x.id === active);
    if (!g) return null;
    const near = games.filter((y) => y.id !== g.id && onGrid(y) && overlaps(y.starts!, s));
    return near.some((y) => sharesTeam(g, y)) ? "team" : near.some((y) => sharesCoach(g, y)) ? "coach" : null;
  };

  function move(id: string, slot: { court: string; starts: string } | null) {
    setPicked(null);
    setDragging(null);
    setError(null);
    const g = games.find((x) => x.id === id);
    if (!g) return;
    if (slot && at(slot.court, slot.starts)) return setError("That slot already has a game. Move that game first.");
    if (slot && !fits(g, slot.court)) {
      const c = courts.get(slot.court)!;
      return setError(
        `${c.gym.name} ${c.name} isn't approved for ${divisions[g.divisionId] ?? "this division"} (Facilities → Courts).`,
      );
    }
    if (!slot && !onGrid(g)) return;
    const before = games;
    setGames(games.map((x) => (x.id === id ? { ...x, court: slot?.court ?? null, starts: slot?.starts ?? null } : x)));
    start(async () => {
      const r = await placeGame(id, slot);
      if (!r.ok) {
        setGames(before);
        setError(r.message);
      } else router.refresh();
    });
  }

  // Several games at once: dropped on a slot, they fill that court's open blocks from there on (skipping blocks that are
  // taken, closed, or when one of the game's teams already plays); dropped on a selection area, they all come off the
  // grid. Each is saved (and checked on the server) one after another.
  function moveMany(list: string[], slot: { court: string; starts: string } | null) {
    setPicked(null);
    setDragging(null);
    setSelected([]);
    setError(null);
    const moving = games.filter((x) => list.includes(x.id)); // in the list's order: youngest first
    if (!moving.length) return;
    const plan = new Map<string, { court: string; starts: string } | null>();
    if (!slot) for (const g of moving) if (onGrid(g)) plan.set(g.id, null);
    if (slot) {
      const c = courts.get(slot.court);
      if (!c) return;
      const times = c.gym.blocks
        .map(([b]) => b)
        .filter((b) => b >= slot.starts && toMin(b) >= toMin(c.starts) && toMin(b) + lenOf(b) <= toMin(c.ends));
      // Where every game is once the planned moves are made.
      const placedAt = (x: GridGame) =>
        plan.has(x.id) ? plan.get(x.id) : onGrid(x) ? { court: x.court!, starts: x.starts! } : null;
      for (const g of moving) {
        if (!fits(g, slot.court)) continue; // that court isn't approved for its division
        const free = times.find((t) => {
          const holder = games.find((y) => y.id !== g.id && placedAt(y)?.court === slot.court && placedAt(y)?.starts === t);
          if (holder) return false;
          return !games.some((y) => {
            const p = y.id === g.id ? null : placedAt(y);
            return p && shares(g, y) && overlaps(p.starts, t);
          });
        });
        if (!free) break;
        plan.set(g.id, { court: slot.court, starts: free });
      }
      if (plan.size < moving.length)
        setError(
          `${plan.size ? `Only ${plan.size} of the ${moving.length} games fit` : "None of those games fit"} on that court from there.`,
        );
    }
    if (!plan.size) return;
    const before = games;
    setGames(
      games.map((x) =>
        plan.has(x.id) ? { ...x, court: plan.get(x.id)?.court ?? null, starts: plan.get(x.id)?.starts ?? null } : x,
      ),
    );
    start(async () => {
      // Games coming off a slot first, so the others can take their places.
      const order = [...plan].sort(([, a], [, b]) => (a ? 1 : 0) - (b ? 1 : 0));
      for (const [id, to] of order) {
        const r = await placeGame(id, to);
        if (!r.ok) {
          setGames(before);
          setError(r.message);
          break;
        }
      }
      router.refresh();
    });
  }

  // Phones: press and hold a game, slide it to a slot (or a selection area) and lift (app/touch-drag).
  const slotOf = (key: string | null) => {
    if (!key) return undefined; // not on a drop area
    if (key.startsWith("pool:")) return null;
    const [court, starts] = key.split("@");
    return { court, starts };
  };
  const touch = useTouchDrag({
    onStart: (data) => {
      if (!data.includes(",")) setSelected([]);
      setPicked(null);
      setDragging(data.split(",")[0]);
    },
    onOver: (key) => setOver(key),
    onDrop: (data, key) => {
      setDragging(null);
      const slot = slotOf(key);
      if (slot === undefined) return;
      if (data.includes(",")) moveMany(data.split(","), slot);
      else move(data, slot);
    },
    onCancel: () => setDragging(null),
  });

  const target = (key: string, slot: { court: string; starts: string } | null) => ({
    "data-drop": key,
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(key);
    },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      const data = e.dataTransfer.getData("text/plain");
      if (/^\d+$/.test(data)) move(data, slot);
      else if (/^\d+(,\d+)+$/.test(data)) moveMany(data.split(","), slot);
    },
    onClick: () => {
      if (touch.justDropped()) return;
      if (selected.length) moveMany(selected, slot);
      else if (picked) move(picked, slot);
    },
  });

  function card(x: GridGame, hostId?: string, full = false) {
    const on = active === x.id || selected.includes(x.id);
    const tbd = { ...(x.home ?? x.away)!, name: "TBD" };
    const [h, v] = [x.home ?? tbd, x.away ?? tbd];
    return (
      <button
        key={x.id}
        type="button"
        draggable
        onDragStart={(e) => {
          // A picked game drags all the picked ones with it.
          const group = selected.includes(x.id) && selected.length > 1 ? selected : null;
          if (!group) setSelected([]);
          e.dataTransfer.setData("text/plain", group ? group.join(",") : x.id);
          setDragging(x.id);
        }}
        onDragEnd={() => setDragging(null)}
        {...touch.source(selected.includes(x.id) && selected.length > 1 ? selected.join(",") : x.id, `${h.name} vs ${v.name}`)}
        title={`${h.name} vs ${v.name} · ${h.division} · ${h.group === v.group ? h.group : `${h.group}/${v.group}`}`}
        onClick={(e) => {
          e.stopPropagation();
          if (touch.justDropped()) return;
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            setPicked(null);
            const base = selected.length ? selected : picked ? [picked] : [];
            setSelected(base.includes(x.id) ? base.filter((i) => i !== x.id) : [...base, x.id]);
            return;
          }
          setSelected([]);
          setPicked(on ? null : x.id);
        }}
        className={`${full ? "block h-full w-full" : "max-w-full"} cursor-grab touch-manipulation rounded-md px-2 py-1.5 text-left text-xs shadow-sm ring-1 select-none [-webkit-touch-callout:none] active:cursor-grabbing ${
          on ? "bg-scenic-navy text-white ring-scenic-navy" : genderCls(x)
        }`}
      >
        <span className="block truncate">
          <GameLevel x={x} /> <TeamName name={h.name} className="font-semibold" /> <CoachBadge tag={x.home?.coach} />
          {hostId && isHome(x, hostId) && (
            <span className={`font-semibold ${on ? "" : "text-emerald-700 dark:text-emerald-300"}`}> (H)</span>
          )}
          <span className={on ? "text-white/80" : "text-zinc-500"}> vs </span>
          <TeamName name={v.name} className="font-semibold" /> <CoachBadge tag={x.away?.coach} />
          <span className={`text-[11px] ${on ? "text-white/80" : "text-zinc-500"}`}>
            {" "}
            · {h.group === v.group ? h.group : `${h.group}/${v.group}`}
            {x.league && ` · ${x.league}`}
          </span>
        </span>
      </button>
    );
  }

  const ring = (key: string) =>
    over === key
      ? "bg-sky-50 ring-2 ring-scenic-navy dark:bg-sky-500/10 dark:ring-white"
      : active
        ? "ring-1 ring-scenic-navy/40 dark:ring-white/40"
        : "ring-1 ring-zinc-950/10 dark:ring-white/15";

  const noHome = games.filter(homeless);
  return (
    <div className="space-y-3">
      {touch.ghost}
      {error && <Alert tone="red">{error}</Alert>}
      {selected.length > 1 && (
        <p className="flex items-center justify-between gap-2 rounded-md bg-scenic-navy/10 px-2 py-1 text-xs font-semibold text-scenic-navy dark:bg-white/10 dark:text-white">
          {selected.length} games picked: drag one (or tap a slot) to place them in that court&apos;s next open blocks, youngest
          first.
          <button type="button" onClick={() => setSelected([])} className="shrink-0 underline">
            Clear
          </button>
        </p>
      )}
      {!active && (
        <p className="text-xs text-zinc-500">
          On a phone, press and hold a game, then slide it to a slot (or tap a game, then a slot). On a computer, hold Shift and
          click games to pick several and move them together.
        </p>
      )}
      {active && (
        <p className="text-xs text-zinc-500">
          Tap or drop on an open slot. <span className="font-semibold text-red-600 dark:text-red-400">Red</span>: a team in this
          game or one of its coaches (Head or Assistant) already has a game then.{" "}
          <span className="font-semibold text-red-700 dark:text-red-300">Dark red</span>: that court isn&apos;t approved for this
          game&apos;s division. Drop on a selection area to take it off the grid.
        </p>
      )}
      {gyms.map((g) => {
        const open = (c: { starts: string; ends: string }, [a, b]: [string, string]) =>
          toMin(c.starts) <= toMin(a) && toMin(b) <= toMin(c.ends);
        const slots = g.blocks.reduce((n, b) => n + g.courts.filter((c) => open(c, b)).length, 0);
        const placed = games.filter((x) => onGrid(x) && courts.get(x.court!)?.gym.key === g.key).length;
        const home = games.filter((x) => isHome(x, g.hostId) && !onGrid(x));
        const pool = home.length ? home : noHome.filter((x) => !onGrid(x));
        return (
          <details
            key={g.key}
            open={opened.has(g.key)}
            onToggle={(e) => {
              const isOpen = (e.currentTarget as HTMLDetailsElement).open;
              setOpened((o) => {
                if (isOpen === o.has(g.key)) return o;
                const n = new Set(o);
                if (isOpen) n.add(g.key);
                else n.delete(g.key);
                return n;
              });
            }}
            className="group overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-white/10"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-zinc-50 px-3 py-2 dark:bg-white/5 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 text-sm">
                <span className="font-semibold">
                  <span className="mr-1 inline-block text-zinc-400 transition [details[open]>summary_&]:rotate-90">›</span>
                  {g.name}
                </span>
                <span className="block text-xs text-zinc-500">
                  {g.host}
                  {g.address && ` · ${g.address}`}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs text-zinc-500">
                {label(g.opens)} – {label(g.closes)}
                <span className="block">
                  {g.courts.length} court{g.courts.length === 1 ? "" : "s"} · {placed}/{slots} slots filled
                </span>
              </span>
            </summary>
            {placed > 0 && (
              <div className="flex justify-end px-3 pt-2">
                {/* A Letter page per game placed here, filled in with the teams and their rosters, to print or save as a PDF. */}
                <a
                  href={`/print/scoresheets?day=${day}&gym=${encodeURIComponent(g.key)}`}
                  target="_blank"
                  rel="noopener"
                  className="rounded-full px-3 py-1 text-xs font-semibold text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
                >
                  🖨 Scoresheets ({placed})
                </a>
              </div>
            )}
            {g.blocks.length ? (
              <div className="overflow-x-auto">
                {/* Every court's column the same width (the time column narrow); scrolls sideways when they don't fit. */}
                <table className="w-full table-fixed border-collapse text-xs" style={{ minWidth: 80 + g.courts.length * 144 }}>
                  <colgroup>
                    <col style={{ width: 80 }} />
                    {g.courts.map((c) => (
                      <col key={c.id} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr className="bg-white dark:bg-zinc-950">
                      <th className="sticky left-0 z-[1] bg-white px-2 py-1.5 text-left font-semibold whitespace-nowrap dark:bg-zinc-950">
                        Time
                      </th>
                      {g.courts.map((c) => (
                        <th key={c.id} className="px-2 py-1.5 text-left align-top font-semibold">
                          {c.name}
                          {(c.starts !== g.opens || c.ends !== g.closes) && (
                            <span className="block font-normal text-zinc-500">
                              {label(c.starts)} – {label(c.ends)}
                            </span>
                          )}
                          {c.divisions && (
                            <span className="block font-normal text-zinc-500">
                              Only {c.divisions.map((d) => divisions[d] ?? "another division").join(", ")}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                    {g.blocks.map((b) => (
                      <tr key={b[0]}>
                        <td className="sticky left-0 z-[1] bg-white px-2 py-0.5 font-medium whitespace-nowrap tabular-nums dark:bg-zinc-950">
                          {label(b[0])}
                        </td>
                        {g.courts.map((c) => {
                          const key = `${c.id}@${b[0]}`;
                          if (!open(c, b))
                            return (
                              <td key={c.id} className="px-1 py-0.5">
                                <span className="flex h-8 items-center justify-center rounded-md bg-zinc-100 text-[11px] text-zinc-400 dark:bg-white/5">
                                  Closed
                                </span>
                              </td>
                            );
                          const here = at(c.id, b[0]);
                          const moving = active ? games.find((x) => x.id === active) : undefined;
                          const barred = !here && !!moving && !fits(moving, c.id);
                          const clash = !here && !barred && !!active && busy(b[0]);
                          // Why a slot can't take the game: shown in the slot (a tooltip doesn't show while dragging) and on hover.
                          const why = barred
                            ? `${c.name} doesn't support ${divisions[moving!.divisionId] ?? "this division"}`
                            : clash === "team"
                              ? "A team in this game already plays then"
                              : clash === "coach"
                                ? "A coach (or bound team) already has a game then"
                                : undefined;
                          return (
                            <td key={c.id} className="px-1 py-0.5">
                              <div
                                {...target(key, { court: c.id, starts: b[0] })}
                                title={why}
                                className={`flex h-8 items-center justify-center rounded-md ${here ? "" : "border border-dashed"} ${
                                  barred
                                    ? "border-red-500 bg-red-200 dark:border-red-400 dark:bg-red-500/30"
                                    : clash
                                      ? "border-red-400 bg-red-50 dark:bg-red-500/10"
                                      : here
                                        ? ""
                                        : "border-emerald-400/60 bg-emerald-50/60 dark:border-emerald-400/30 dark:bg-emerald-500/5"
                                } ${over === key ? "ring-2 ring-scenic-navy dark:ring-white" : ""}`}
                              >
                                {here && card(here, g.hostId, true)}
                                {why && (
                                  <span
                                    className={`truncate px-1 text-[10px] font-semibold ${barred ? "text-red-900 dark:text-red-100" : "text-red-700 dark:text-red-300"}`}
                                  >
                                    {why}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-3 py-2 text-sm text-zinc-500">
                Open {label(g.opens)} – {label(g.closes)}: shorter than one game.
              </p>
            )}
            <section
              {...target(`pool:${g.key}`, null)}
              className={`m-2 rounded-lg bg-amber-50/50 p-2 dark:bg-amber-500/5 ${ring(`pool:${g.key}`)}`}
            >
              <h4 className="flex items-baseline justify-between gap-2 text-sm font-semibold">
                {home.length ? `Home games: ${g.host}` : "No home gym games"}
                <span className="text-xs font-normal text-zinc-500">{pool.length} to place</span>
              </h4>
              {!home.length && (
                <p className="text-xs text-zinc-500">No {g.host} games left to place, so these games have no home gym.</p>
              )}
              {pool.length ? (
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">{pool.map((x) => card(x, g.hostId))}</div>
              ) : (
                <p className="mt-1 text-xs text-zinc-400">Every game is placed.</p>
              )}
            </section>
          </details>
        );
      })}
      {games.length > 0 && (
        <section {...target("pool:none", null)} className={`overflow-hidden rounded-lg px-3 py-2 ${ring("pool:none")}`}>
          <h4 className="flex items-baseline justify-between gap-2 text-sm font-semibold">
            No home gym
            <span className="text-xs font-normal text-zinc-500">
              {noHome.filter((x) => !onGrid(x)).length} of {noHome.length} to place
            </span>
          </h4>
          <p className="text-xs text-zinc-500">
            The home team&apos;s school or organization has no gym open this day (or the home side is TBD).
          </p>
          {noHome.length ? (
            <ul className="mt-1 divide-y divide-zinc-100 text-sm dark:divide-white/5">
              {noHome.map((x) => {
                const c = x.court ? courts.get(x.court) : null;
                return (
                  <li
                    key={x.id}
                    className={`my-1 flex items-center justify-between gap-3 rounded-md px-2 py-1 ring-1 ${genderCls(x)}`}
                  >
                    <span className="min-w-0">
                      <GameLevel x={x} /> <TeamName name={x.home?.name ?? "TBD"} className="font-medium" />{" "}
                      <CoachBadge tag={x.home?.coach} />
                      <span className="text-zinc-500"> (H) vs </span>
                      <TeamName name={x.away?.name ?? "TBD"} className="font-medium" /> <CoachBadge tag={x.away?.coach} />
                      <span className="block text-xs text-zinc-500">
                        {(x.home ?? x.away)!.division} · {[x.home, x.away].flatMap((t) => (t ? [t.from] : ["TBD"])).join(" vs ")}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-xs ${onGrid(x) ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-400"}`}
                    >
                      {onGrid(x) && c ? `${c.gym.name} ${c.name} · ${label(x.starts!)}` : "Not placed"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-zinc-400">Every game has a home gym.</p>
          )}
        </section>
      )}
    </div>
  );
}
