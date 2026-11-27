"use client";

import { CoachBadge, LevelTag, TeamName, type CoachTag } from "../../../ui";
import { useEffect, useState, useTransition } from "react";
import { onGameChanges } from "./board-events";
import { useRouter } from "next/navigation";
import { Alert, useConfirm } from "../../../client-ui";
import { placeGame, unscheduleGym } from "../actions";
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
  off?: { label: string; start: number; end: number }[]; // schedule request: times it asked not to play (minutes)
};
export type GridGame = {
  id: string;
  divisionId: string;
  home: GridTeam | null; // the home team: the game belongs at its school's or organization's gym (null: TBD)
  away: GridTeam | null; // null: TBD (one of the two is always a team)
  league: string | null;
  court: string | null;
  starts: string | null;
  locked: boolean; // published: it can't be moved
  level: string; // the game's: REC are placed first
  wrong: string | null; // to correct: a team changed grade or level after it was made
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
// An empty slot's look: idle (nothing picked), or what it says about the picked game.
const SLOT = {
  idle: "border-zinc-300 dark:border-white/15",
  fits: "border-emerald-500 bg-emerald-100 dark:border-emerald-400 dark:bg-emerald-500/25",
  open: "border-zinc-400 bg-white dark:border-white/30 dark:bg-zinc-900",
  tight: "border-yellow-500 bg-yellow-100 dark:border-yellow-400 dark:bg-yellow-500/20",
  away: "border-amber-400 bg-amber-50 dark:border-amber-400/60 dark:bg-amber-500/10",
  clash: "border-red-400 bg-red-50 dark:bg-red-500/10",
  barred: "border-red-500 bg-red-200 dark:border-red-400 dark:bg-red-500/30",
} as const;
const WHY = {
  fits: "",
  open: "",
  tight: "text-yellow-900 dark:text-yellow-100",
  away: "text-amber-800 dark:text-amber-200",
  clash: "text-red-700 dark:text-red-300",
  barred: "text-red-900 dark:text-red-100",
} as const;
// TBD (no opponent yet) stands out wherever a game shows.
const TbdTag = () => (
  <span className="rounded bg-amber-400 px-1 text-[10px] leading-4 font-bold text-amber-950 ring-1 ring-amber-600/40">TBD</span>
);
const LOCKED = "That game is published, so it can't be moved. Unpublish its level for that day first.";
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
// The court is open for the whole block.
const isOpen = (c: { starts: string; ends: string }, [a, b]: [string, string]) =>
  toMin(c.starts) <= toMin(a) && toMin(b) <= toMin(c.ends);
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
  programId,
  gyms,
  games: initial,
  minutes,
  divisions,
  wide = false,
  readOnly = false,
}: {
  readOnly?: boolean; // Admins and Owners: they see it (and can pick a game to see what fits); only Directors of Scheduling change it
  wide?: boolean; // Scheduler View: every gym open, side by side as the screen allows
  day: string; // YYYY-MM-DD: the Game Day (for its gyms' printable scoresheets)
  programId: string; // the program being scheduled (Unschedule all takes off only its games)
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
  // A change made in Matchups: redrawn here at once, with teams this grid already knows (others wait for the reload).
  useEffect(
    () =>
      onGameChanges((changes) =>
        setGames((list) => {
          const known = new Map(list.flatMap((x) => [x.home, x.away]).flatMap((t) => (t ? [[t.id, t] as const] : [])));
          const ok = (id: string | null) => id === null || known.has(id);
          return list.map((x) => {
            const c = changes.find((y) => y.id === x.id);
            if (!c || !ok(c.home) || !ok(c.away) || (!c.home && !c.away)) return x;
            return { ...x, home: c.home ? known.get(c.home)! : null, away: c.away ? known.get(c.away)! : null };
          });
        }),
      ),
    [],
  );
  const [opened, setOpened] = useState<Set<string>>(() => new Set(wide ? gyms.map((g) => g.key) : []));
  const [picked, setPicked] = useState<string | null>(null);
  // Shift-click (or Cmd/Ctrl-click) picks several games to move together.
  const [selected, setSelected] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy2, start] = useTransition();
  const [confirm, dialog] = useConfirm();
  const unschedule = async (g: GridGymView, n: number) => {
    if (
      !(await confirm({
        title: `Unschedule all games at ${g.name}?`,
        message: `${n} game${n === 1 ? "" : "s"} come${n === 1 ? "s" : ""} off this gym's courts for the day. The matchups stay, ready to place again. Published games stay where they are.`,
        confirmLabel: "Unschedule all",
      }))
    )
      return;
    setError(null);
    start(async () => {
      const r = await unscheduleGym(day, g.key, programId);
      if (!r.ok) return setError(r.message);
      router.refresh();
    });
  };
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
  // Two games at different gyms: the time between them (the end of one to the start of the other), in games of length
  // `len`: under 1, back to back (red: not allowed); under 2, one game's break (yellow: allowed); else fine. Same gym: fine.
  type Place = { court: string; starts: string };
  const breakOf = (a: Place, b: Place, len: number) => {
    if (courts.get(a.court)?.gym.key === courts.get(b.court)?.gym.key) return Infinity;
    const gap = Math.max(toMin(b.starts) - (toMin(a.starts) + lenOf(a.starts)), toMin(a.starts) - (toMin(b.starts) + lenOf(b.starts)));
    return gap / len;
  };
  const tooClose = (a: Place, b: Place) => breakOf(a, b, lenOf(b.starts)) < 1;
  const busy = (s: string, court: string): "team" | "coach" | "team-far" | "coach-far" | null => {
    const g = active && games.find((x) => x.id === active);
    if (!g) return null;
    const near = games.filter((y) => y.id !== g.id && onGrid(y) && overlaps(y.starts!, s));
    if (near.some((y) => sharesTeam(g, y))) return "team";
    if (near.some((y) => sharesCoach(g, y))) return "coach";
    const far = games.filter((y) => y.id !== g.id && onGrid(y) && tooClose({ court: y.court!, starts: y.starts! }, { court, starts: s }));
    return far.some((y) => sharesTeam(g, y)) ? "team-far" : far.some((y) => sharesCoach(g, y)) ? "coach-far" : null;
  };
  // Only one game's break before or after a game of its team or coach at another gym (allowed, but tight).
  const tight = (s: string, court: string) => {
    const g = active && games.find((x) => x.id === active);
    return !!g && games.some((y) => y.id !== g.id && onGrid(y) && shares(g, y) && breakOf({ court: y.court!, starts: y.starts! }, { court, starts: s }, lenOf(s)) < 2);
  };
  // Schedule requests: a team in the game asked not to play then (the whole game must miss those blocks).
  const askedOff = (x: GridGame, s: string) => {
    for (const t of [x.home, x.away]) {
      const hit = (t?.off ?? []).filter((b) => toMin(s) < b.end && b.start < toMin(s) + lenOf(s));
      if (hit.length) return `${t!.name} asked not to play ${hit.map((b) => b.label).join(" or ")}`;
    }
    return null;
  };
  const moving = active ? games.find((x) => x.id === active) : undefined;
  // The gym's host the moving game belongs with: its home team's (null: no host open this day, so any gym is home).
  const homeHost = moving?.home && hosts.has(moving.home.partnerId ?? "") ? moving.home.partnerId : null;
  // No home gym for it: no host open, or none of its host's courts take its division. Then a slot it fits stays white.
  const noHomeGym = !!moving && (!homeHost || !gyms.some((g) => g.hostId === homeHost && g.courts.some((c) => fits(moving, c.id))));
  // What an empty, open slot says while a game is picked or dragged: it fits (green), it fits but isn't the home team's
  // gym (amber), or why it can't (red).
  type Slot = { tone: "fits" | "open" | "tight" | "away" | "clash" | "barred"; why?: string };
  const slotFor = (g: GridGymView, c: GridGymView["courts"][number], starts: string): Slot | null => {
    if (!moving || at(c.id, starts)) return null;
    if (!fits(moving, c.id)) return { tone: "barred", why: `${c.name} doesn't support ${divisions[moving.divisionId] ?? "this division"}` };
    const asked = askedOff(moving, starts);
    if (asked) return { tone: "clash", why: asked };
    const clash = busy(starts, c.id);
    if (clash === "team") return { tone: "clash", why: "A team in this game already plays then" };
    if (clash === "coach") return { tone: "clash", why: "A coach (or bound team) already has a game then" };
    if (clash === "team-far") return { tone: "clash", why: "Back to back: a team plays at another gym" };
    if (clash === "coach-far") return { tone: "clash", why: "Back to back: a coach (or bound team) is at another gym" };
    if (tight(starts, c.id)) return { tone: "tight", why: "One game's break: a team or coach is at another gym" };
    if (noHomeGym) return { tone: "open" };
    if (homeHost && g.hostId !== homeHost) return { tone: "away", why: "Fits, but not the home team's gym" };
    return { tone: "fits" };
  };
  // Every slot the moving game fits in, at its home team's gym.
  const fitCount = moving
    ? gyms.reduce(
        (n, g) =>
          n + g.blocks.reduce((m, b) => m + g.courts.filter((c) => isOpen(c, b) && ["fits", "open"].includes(slotFor(g, c, b[0])?.tone ?? "")).length, 0),
        0,
      )
    : 0;

  function move(id: string, slot: { court: string; starts: string } | null) {
    setPicked(null);
    setDragging(null);
    setError(null);
    if (readOnly) return setError("View only: only Directors of Scheduling change the schedule.");
    const g = games.find((x) => x.id === id);
    if (!g) return;
    if (g.locked) return setError(LOCKED);
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
    if (readOnly) return setError("View only: only Directors of Scheduling change the schedule.");
    const moving = games.filter((x) => list.includes(x.id) && !x.locked); // in the list's order: REC youngest first, then COMP
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
          if (askedOff(g, t)) return false;
          const holder = games.find((y) => y.id !== g.id && placedAt(y)?.court === slot.court && placedAt(y)?.starts === t);
          if (holder) return false;
          return !games.some((y) => {
            const p = y.id === g.id ? null : placedAt(y);
            return p && shares(g, y) && (overlaps(p.starts, t) || tooClose(p, { court: slot.court, starts: t }));
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
    // Linked to the picked game: one of its teams, or one of its coaches (or a bound team), plays in this one too.
    const link = moving && moving.id !== x.id ? (sharesTeam(moving, x) ? "Same team" : sharesCoach(moving, x) ? "Same coach" : null) : null;
    const linkTag = link && (
      <span className="mr-1 rounded bg-fuchsia-600 px-1 text-[10px] leading-4 font-bold text-white">{link}</span>
    );
    const name = (t: GridTeam | null, n: string) => (t ? <TeamName name={n} className="font-semibold" /> : <TbdTag />);
    const home = hostId && isHome(x, hostId) && (
      <span className={`font-semibold ${on ? "" : "text-emerald-700 dark:text-emerald-300"}`}> (H)</span>
    );
    const sub = (
      <span className={`text-[11px] ${on ? "text-white/80" : "text-zinc-500"}`}>
        {full ? " · " : ""}
        {h.group === v.group ? h.group : `${h.group}/${v.group}`}
        {x.league && ` · ${x.league}`}
      </span>
    );
    return (
      <button
        key={x.id}
        type="button"
        draggable={!x.locked && !readOnly}
        onDragStart={(e) => {
          // A picked game drags all the picked ones with it.
          const group = selected.includes(x.id) && selected.length > 1 ? selected : null;
          if (!group) setSelected([]);
          e.dataTransfer.setData("text/plain", group ? group.join(",") : x.id);
          setDragging(x.id);
        }}
        onDragEnd={() => setDragging(null)}
        {...(x.locked || readOnly ? {} : touch.source(selected.includes(x.id) && selected.length > 1 ? selected.join(",") : x.id, `${h.name} vs ${v.name}`))}
        title={`${x.wrong ? `To correct: ${x.wrong} · ` : ""}${x.locked ? "Published: can't be moved · " : ""}${h.name} vs ${v.name} · ${h.division} · ${h.group === v.group ? h.group : `${h.group}/${v.group}`}`}
        onClick={(e) => {
          e.stopPropagation();
          if (touch.justDropped()) return;
          if (x.locked) return setError(LOCKED);
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            setPicked(null);
            const base = selected.length ? selected : picked ? [picked] : [];
            setSelected(base.includes(x.id) ? base.filter((i) => i !== x.id) : [...base, x.id]);
            return;
          }
          setSelected([]);
          setPicked(on ? null : x.id);
        }}
        className={`${full ? "block h-full w-full" : "block w-full"} ${x.locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"} touch-manipulation rounded-md px-2 py-1.5 text-left text-xs shadow-sm ring-1 select-none [-webkit-touch-callout:none] ${
          on ? "bg-scenic-navy text-white ring-scenic-navy" : x.wrong ? "bg-red-100 ring-2 ring-red-600 dark:bg-red-500/25" : genderCls(x)
        } ${link ? "outline-3 outline-offset-[-3px] outline-fuchsia-600" : !x.home || !x.away ? "outline-2 outline-offset-[-2px] outline-amber-500 outline-dashed" : ""}`}
      >
        {full ? (
          <span className="block truncate">
            {linkTag}
            {x.wrong && <span aria-label="To correct">⚠ </span>}
            {x.locked && <span aria-label="Published">🔒 </span>}
            <GameLevel x={x} /> {name(x.home, h.name)} <CoachBadge tag={x.home?.coach} />
            {home}
            <span className={on ? "text-white/80" : "text-zinc-500"}> vs </span>
            {name(x.away, v.name)} <CoachBadge tag={x.away?.coach} />
            {sub}
          </span>
        ) : (
          // Waiting to be placed: the teams stacked, each name readable.
          <>
            <span className="block">
              {linkTag}
              {x.wrong && <span aria-label="To correct">⚠ </span>}
              {x.locked && <span aria-label="Published">🔒 </span>}
              <GameLevel x={x} /> {name(x.home, h.name)} <CoachBadge tag={x.home?.coach} />
              {home}
            </span>
            <span className="block">
              <span className={on ? "text-white/80" : "text-zinc-500"}>vs </span>
              {name(x.away, v.name)} <CoachBadge tag={x.away?.coach} />
            </span>
            <span className="block">{sub}</span>
          </>
        )}
      </button>
    );
  }

  const ring = (key: string) =>
    over === key
      ? "bg-sky-50 ring-2 ring-scenic-navy dark:bg-sky-500/10 dark:ring-white"
      : active
        ? "ring-1 ring-scenic-navy/40 dark:ring-white/40"
        : "ring-1 ring-zinc-950/10 dark:ring-white/15";

  // Its home team's host has a gym open, but no court there takes the game's division (a gym only for K–1st).
  const noCourt = (x: GridGame) =>
    !homeless(x) && !gyms.some((g) => g.hostId === x.home!.partnerId && g.courts.some((c) => fits(x, c.id)));
  const noHome = games.filter((x) => homeless(x) || noCourt(x));

  // Which of its host's gyms each game still to place is listed under: one whose courts take its division, the one with
  // the most open slots left, so a host's games spread over its gyms. Games come sorted: REC youngest first, then COMP.
  const listedAt = new Map<string, string>(); // game id → gym key
  const suggested = new Map<string, string>(); // a game with no home gym listed at a gym → why there
  {
    const room = new Map(
      gyms.map((g) => [
        g.key,
        g.blocks.reduce((n, b) => n + g.courts.filter((c) => isOpen(c, b)).length, 0) -
          games.filter((x) => onGrid(x) && courts.get(x.court!)?.gym.key === g.key).length,
      ]),
    );
    for (const x of games) {
      if (onGrid(x) || homeless(x) || noCourt(x)) continue;
      const takes = gyms.filter((g) => g.hostId === x.home!.partnerId && g.courts.some((c) => fits(x, c.id)));
      const best = takes.reduce((a, b) => (room.get(b.key)! > room.get(a.key)! ? b : a));
      listedAt.set(x.id, best.key);
      room.set(best.key, room.get(best.key)! - 1);
    }
    // A game with no home gym (or whose host's courts don't take its division): suggested at one gym whose courts do (none:
    // not suggested anywhere), first where one of its teams or coaches already plays that day (placed or listed there), then
    // the most open slots.
    const gymOf = (y: GridGame) => (onGrid(y) ? courts.get(y.court!)?.gym.key : listedAt.get(y.id));
    for (const x of games) {
      if (onGrid(x) || !(homeless(x) || noCourt(x))) continue;
      const takes = gyms.filter((g) => g.courts.some((c) => fits(x, c.id)));
      if (!takes.length) continue;
      const near = (g: GridGymView) => games.filter((y) => y.id !== x.id && gymOf(y) === g.key && shares(x, y)).length;
      const best = takes.reduce((a, b) => (near(b) > near(a) || (near(b) === near(a) && room.get(b.key)! > room.get(a.key)!) ? b : a));
      listedAt.set(x.id, best.key);
      const why = noCourt(x) ? `${gyms.find((g) => g.hostId === x.home!.partnerId)?.host ?? "Its host"}'s gym doesn't take this division` : null;
      const here = near(best) > 0 ? "a coach or team of this game plays here too" : "room here";
      suggested.set(x.id, why ? `${why}: ${here}` : here.charAt(0).toUpperCase() + here.slice(1));
      room.set(best.key, room.get(best.key)! - 1);
    }
  }

  return (
    <div className="space-y-3">
      {touch.ghost}
      {dialog}
      {/* Shown where it's seen, wherever the game was dropped. */}
      {error && (
        <div role="alert" className="fixed inset-x-3 bottom-4 z-50 mx-auto max-w-lg shadow-lg">
          <Alert tone="red">
            <span className="flex items-start justify-between gap-3">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Close" className="shrink-0 font-semibold">
                ✕
              </button>
            </span>
          </Alert>
        </div>
      )}
      {selected.length > 1 && (
        <p className="flex items-center justify-between gap-2 rounded-md bg-scenic-navy/10 px-2 py-1 text-xs font-semibold text-scenic-navy dark:bg-white/10 dark:text-white">
          {selected.length} games picked: drag one (or tap a slot) to place them in that court&apos;s next open blocks, REC
          youngest first, then COMP.
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
          <span className="font-semibold text-emerald-700 dark:text-emerald-300">
            {moving?.locked ? "Published: it can't be moved." : `Fits in ${fitCount} slot${fitCount === 1 ? "" : "s"}`}
          </span>{" "}
          Tap or drop on a slot. <span className="font-semibold text-emerald-700 dark:text-emerald-300">Green</span>: it fits
          at the home team&apos;s gym (white: it has no home gym, so any gym is fine). <span className="font-semibold text-amber-700 dark:text-amber-300">Amber</span>: it fits,
          but at another host&apos;s gym. <span className="font-semibold text-red-600 dark:text-red-400">Red</span>: a team in
          this game or one of its coaches (Head or Assistant) already has a game then, or one at another gym right before or after.{" "}
          <span className="font-semibold text-yellow-700 dark:text-yellow-300">Yellow</span>: allowed, but only one game&apos;s
          break from a game of theirs at another gym.{" "}
          <span className="font-semibold text-fuchsia-700 dark:text-fuchsia-300">Pink outline</span>: a game with the same team or
          coach.{" "}
          <span className="font-semibold text-red-700 dark:text-red-300">Dark red</span>: that court isn&apos;t approved for this
          game&apos;s division. Drop on a selection area to take it off the grid.
        </p>
      )}
            <div className={wide ? "grid items-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,30rem),1fr))]" : "space-y-3"}>
      {gyms.map((g) => {
        const open = isOpen;
        const slots = g.blocks.reduce((n, b) => n + g.courts.filter((c) => open(c, b)).length, 0);
        const placed = games.filter((x) => onGrid(x) && courts.get(x.court!)?.gym.key === g.key).length;
        const free = games.filter((x) => onGrid(x) && !x.locked && courts.get(x.court!)?.gym.key === g.key).length;
        const here = games.filter((x) => listedAt.get(x.id) === g.key);
        const home = here.filter((x) => !suggested.has(x.id));
        const extra = here.filter((x) => suggested.has(x.id)); // no home gym: suggested here
        const hostHas = games.some((x) => isHome(x, g.hostId) && !onGrid(x));
        const pool = here;
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
              <div className="flex flex-wrap justify-end gap-2 px-3 pt-2">
                {free > 0 && !readOnly && (
                  <button
                    type="button"
                    disabled={busy2}
                    onClick={() => unschedule(g, free)}
                    className="rounded-full px-3 py-1 text-xs font-semibold text-red-600 ring-1 ring-red-600/30 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    Unschedule all ({free})
                  </button>
                )}
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
                          const st = slotFor(g, c, b[0]);
                          // Why: shown in the slot (a tooltip doesn't show while dragging) and on hover.
                          const why = st?.why;
                          return (
                            <td key={c.id} className="px-1 py-0.5">
                              <div
                                {...target(key, { court: c.id, starts: b[0] })}
                                title={why}
                                className={`flex h-8 items-center justify-center rounded-md ${here ? "" : "border border-dashed"} ${
                                  here ? "" : SLOT[st?.tone ?? "idle"]
                                } ${over === key ? "ring-2 ring-scenic-navy dark:ring-white" : ""}`}
                              >
                                {here && card(here, g.hostId, true)}
                                {why && (
                                  <span
                                    className={`truncate px-1 text-[10px] font-semibold ${WHY[st!.tone]}`}
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
                {`Home games: ${g.host}`}
                <span className="text-xs font-normal text-zinc-500">{pool.length} to place</span>
              </h4>
              {home.length ? (
                <div className={`mt-1.5 grid grid-cols-2 gap-1.5 ${wide ? "" : "sm:grid-cols-3"}`}>{home.map((x) => card(x, g.hostId))}</div>
              ) : (
                <p className="mt-1 text-xs text-zinc-400">
                  {hostHas ? `${g.host}'s games are listed at its other gym, where they fit best.` : `No ${g.host} games left to place.`}
                </p>
              )}
              {extra.length > 0 && (
                <>
                  <h5 className="mt-2 text-xs font-semibold">No home gym: suggested here</h5>
                  <div className={`mt-1 grid grid-cols-2 gap-1.5 ${wide ? "" : "sm:grid-cols-3"}`}>
                    {extra.map((x) => (
                      <div key={x.id}>
                        {card(x, g.hostId)}
                        <span className="block px-1 text-[10px] text-zinc-500">{suggested.get(x.id)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </details>
        );
      })}
      </div>
      {games.length > 0 && (
        <section {...target("pool:none", null)} className={`overflow-hidden rounded-lg px-3 py-2 ${ring("pool:none")}`}>
          <h4 className="flex items-baseline justify-between gap-2 text-sm font-semibold">
            No home gym
            <span className="text-xs font-normal text-zinc-500">
              {noHome.filter((x) => !onGrid(x)).length} of {noHome.length} to place
            </span>
          </h4>
          <p className="text-xs text-zinc-500">
            The home team&apos;s school or organization has no gym open this day, or none whose courts take its division (or the home side is TBD).
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
                      <GameLevel x={x} /> {x.home ? <TeamName name={x.home.name} className="font-medium" /> : <TbdTag />}{" "}
                      <CoachBadge tag={x.home?.coach} />
                      <span className="text-zinc-500"> (H) vs </span>
                      {x.away ? <TeamName name={x.away.name} className="font-medium" /> : <TbdTag />} <CoachBadge tag={x.away?.coach} />
                      <span className="block text-xs text-zinc-500">
                        {(x.home ?? x.away)!.division} · {[x.home, x.away].flatMap((t) => (t ? [t.from] : ["TBD"])).join(" vs ")}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 text-xs ${onGrid(x) ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-400"}`}
                    >
                      {onGrid(x) && c
                        ? `${c.gym.name} ${c.name} · ${label(x.starts!)}`
                        : listedAt.has(x.id)
                          ? `Not placed · suggested at ${gyms.find((g) => g.key === listedAt.get(x.id))?.name}`
                          : "Not placed · no open court takes its division"}
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
