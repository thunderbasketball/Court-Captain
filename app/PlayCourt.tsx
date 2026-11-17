"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import {
  BASKET,
  COURT_H,
  COURT_W,
  DEFENSE,
  MAX_FRAMES,
  MAX_LINES,
  OFFENSE,
  defenderSpot,
  bendControl,
  canCurve,
  isDefenseLine,
  lineDistance,
  linePoint,
  isOffense,
  nextFrame,
  startFrame,
  type Frame,
  type LineKind,
  type PlayLine,
  type Spot,
} from "@/lib/play-diagram";

// CourtPlaybook's high school half court (SPEC.md section 14): the baseline at the top, players as circles (offense 1–5, blue) and
// X1–X5 (defense, red), the ball as an orange ring, and lines: cut (solid arrow), pass (dashed arrow), dribble (zigzag
// arrow), screen (a bar at its end).

const R = 19; // a player's radius
const chip = (on: boolean) =>
  `rounded-full px-3 py-1 text-sm font-medium ring-1 ${on ? "bg-thunder-blue text-white ring-thunder-blue" : "text-zinc-600 ring-zinc-950/15 dark:text-zinc-300 dark:ring-white/20"}`;

function CourtLines() {
  // High school (NFHS): lane 12 ft wide, the free-throw line 19 ft from the baseline (6 ft circle); the 3-point line
  // 19 ft 9 in from the basket's center, straight in the corners for its first 5 ft 3 in; backboard 4 ft in, 6 ft wide;
  // center circle 6 ft. No restricted-area arc.
  const three = 197.5;
  return (
    <g fill="none" stroke="currentColor" strokeWidth={3} className="text-amber-900/40 dark:text-amber-100/30">
      <rect x={1.5} y={1.5} width={COURT_W - 3} height={COURT_H - 3} />
      <rect x={190} y={0} width={120} height={190} />
      <circle cx={250} cy={190} r={60} />
      <path d={`M${BASKET.x - three} 0 V${BASKET.y} A${three} ${three} 0 0 0 ${BASKET.x + three} ${BASKET.y} V0`} />
      <line x1={220} y1={40} x2={280} y2={40} strokeWidth={5} />
      <circle cx={BASKET.x} cy={BASKET.y} r={9} className="text-orange-500" stroke="currentColor" />
      <path d={`M190 ${COURT_H} A60 60 0 0 1 310 ${COURT_H}`} />
    </g>
  );
}

// A line from where its player stands to its end, shortened so it starts at the player's edge.
const RED = "#dc2626";
function LinePath({ line, from, ids, faint = false }: { line: PlayLine; from: Spot; ids: { arrow: string; red: string }; faint?: boolean }) {
  const c = bendControl(from, line);
  // Leaves the player's circle heading toward the curve's control point (or the end, when straight).
  const hx = (c ?? line).x - from.x;
  const hy = (c ?? line).y - from.y;
  const hl = Math.hypot(hx, hy);
  const len = Math.hypot(line.x - from.x, line.y - from.y);
  if (len < R + 4 || hl < 1) return null;
  const sx = from.x + (hx / hl) * (R + 2);
  const sy = from.y + (hy / hl) * (R + 2);
  const ex = line.x;
  const ey = line.y;
  const start = { x: sx, y: sy };
  // The point and its direction at t along the drawn line (from the circle's edge to the end).
  const pt = (t: number) => linePoint(start, line, t);
  const dir = (t: number) => {
    const a = pt(Math.max(0, t - 0.01));
    const b = pt(Math.min(1, t + 0.01));
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { ux: (b.x - a.x) / d, uy: (b.y - a.y) / d };
  };
  const d = c ? `M${sx} ${sy} Q${2 * line.bx! - (sx + ex) / 2} ${2 * line.by! - (sy + ey) / 2} ${ex} ${ey}` : `M${sx} ${sy} L${ex} ${ey}`;
  const red = isDefenseLine(line.kind);
  const common = { stroke: red ? RED : "currentColor", strokeWidth: 4, fill: "none", opacity: faint ? 0.35 : 1, strokeLinecap: "round" as const };
  const arrow = `url(#${red ? ids.red : ids.arrow})`;
  // A short bar across the line at t (0 = its start, 1 = its end), `w` each side, moved `back` toward the start.
  const bar = (t: number, w: number, back = 0) => {
    const p = pt(t);
    const { ux, uy } = dir(t);
    const x = p.x - ux * back;
    const y = p.y - uy * back;
    return <line x1={x + uy * w} y1={y - ux * w} x2={x - uy * w} y2={y + ux * w} />;
  };
  if (line.kind === "closeout")
    return (
      <g {...common}>
        <path d={d} markerEnd={arrow} />
        {bar(0.62, 11)}
        {bar(0.74, 11)}
      </g>
    );
  if (line.kind === "trap")
    return (
      <g {...common}>
        <path d={d} />
        {bar(1, 18)}
        {bar(1, 18, 9)}
      </g>
    );
  if (line.kind === "deny")
    return (
      <g {...common}>
        <path d={d} strokeDasharray="2 9" />
        <circle cx={ex} cy={ey} r={7} fill={RED} stroke="none" />
      </g>
    );
  if (line.kind === "switch") {
    const m = pt(0.5);
    const { ux, uy } = dir(0.5);
    return (
      <g {...common}>
        <path d={d} strokeDasharray="12 10" markerEnd={arrow} />
        <text x={m.x - uy * 16} y={m.y + ux * 16} textAnchor="middle" dominantBaseline="central" fill={RED} stroke="none" fontSize={20} fontWeight={800}>
          S
        </text>
      </g>
    );
  }
  if (line.kind === "screen")
    return (
      <g {...common}>
        <path d={d} />
        <g strokeWidth={6}>{bar(1, 22)}</g>
      </g>
    );
  if (line.kind === "dribble") {
    // A zigzag along the line, straight for its last bit so the arrow sits cleanly.
    const run = Math.hypot(ex - sx, ey - sy) * (c ? 1.15 : 1);
    const n = Math.max(2, Math.floor((run - 24) / 16));
    const pts = [`M${sx} ${sy}`];
    for (let k = 1; k <= n; k++) {
      const t = (k * 16) / run;
      const p = pt(t);
      const { ux, uy } = dir(t);
      const side = k % 2 ? 9 : -9;
      pts.push(`L${p.x - uy * side} ${p.y + ux * side}`);
    }
    pts.push(`L${ex} ${ey}`);
    return <path d={pts.join(" ")} {...common} strokeLinejoin="round" markerEnd={arrow} />;
  }
  return <path d={d} {...common} strokeDasharray={line.kind === "pass" ? "12 10" : undefined} markerEnd={arrow} />;
}

function Player({ spot, ball, moving }: { spot: Spot; ball: boolean; moving: boolean }) {
  const offense = isOffense(spot.id);
  return (
    <g style={{ transform: `translate(${spot.x}px, ${spot.y}px)`, transition: moving ? "transform 0.9s ease-in-out" : undefined }}>
      {ball ? (
        // The player with the ball: a basketball (orange with its seams) behind their number.
        <>
          <circle r={R + 3} fill="#ea7a1a" stroke="#431407" strokeWidth={2.5} />
          <g fill="none" stroke="#431407" strokeWidth={1.8} opacity={0.85}>
            <line x1={0} y1={-(R + 3)} x2={0} y2={R + 3} />
            <line x1={-(R + 3)} y1={0} x2={R + 3} y2={0} />
            <path d={`M${-(R - 6)} ${-(R - 2)} Q${-4} 0 ${-(R - 6)} ${R - 2}`} />
            <path d={`M${R - 6} ${-(R - 2)} Q4 0 ${R - 6} ${R - 2}`} />
          </g>
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fill="#ffffff"
            stroke="#431407"
            strokeWidth={4}
            paintOrder="stroke"
            fontSize={22}
            fontWeight={800}
          >
            {spot.id}
          </text>
        </>
      ) : offense ? (
        <>
          <circle r={R} className="fill-white stroke-thunder-blue dark:fill-zinc-900" strokeWidth={4} />
          <text textAnchor="middle" dominantBaseline="central" className="fill-thunder-blue dark:fill-sky-300" fontSize={22} fontWeight={700}>
            {spot.id}
          </text>
        </>
      ) : (
        <text textAnchor="middle" dominantBaseline="central" className="fill-red-600 dark:fill-red-400" fontSize={22} fontWeight={800}>
          {spot.id}
        </text>
      )}
    </g>
  );
}

// The court with one frame on it. `preview`: the line being drawn right now.
function Court({
  frame,
  moving = false,
  svgRef,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  touchNone = false,
  preview,
  handles = false,
  label,
}: {
  frame: Frame;
  moving?: boolean;
  svgRef?: Ref<SVGSVGElement>;
  onPointerDown?: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove?: (e: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (e: ReactPointerEvent<SVGSVGElement>) => void;
  touchNone?: boolean;
  preview?: PlayLine | null;
  handles?: boolean; // editing: a small dot at each line's middle, to drag it into a curve
  label: string;
}) {
  const id = useId().replace(/:/g, "");
  const ids = { arrow: `arrow-${id}`, red: `arrow-red-${id}` };
  const at = (pid: string) => frame.spots.find((s) => s.id === pid);
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${COURT_W} ${COURT_H}`}
      role="img"
      aria-label={label}
      className="block w-full rounded-xl bg-amber-50 text-zinc-800 ring-1 ring-amber-900/15 select-none dark:bg-amber-950/30 dark:text-zinc-100 dark:ring-white/10"
      style={touchNone ? { touchAction: "none" } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <defs>
        <marker id={ids.arrow} viewBox="0 0 10 10" refX={8} refY={5} markerWidth={4} markerHeight={4} orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
        </marker>
        <marker id={ids.red} viewBox="0 0 10 10" refX={8} refY={5} markerWidth={4} markerHeight={4} orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={RED} />
        </marker>
      </defs>
      <CourtLines />
      {frame.lines.map((l, i) => {
        const from = at(l.from);
        return from ? <LinePath key={i} line={l} from={from} ids={ids} /> : null;
      })}
      {preview && at(preview.from) && <LinePath line={preview} from={at(preview.from)!} ids={ids} faint />}
      {handles &&
        frame.lines.map((l, i) => {
          const from = at(l.from);
          if (!from || !canCurve(l.kind)) return null;
          const m = linePoint(from, l, 0.5);
          return <circle key={`h${i}`} cx={m.x} cy={m.y} r={6} fill="white" stroke={isDefenseLine(l.kind) ? RED : "currentColor"} strokeWidth={2} opacity={0.85} />;
        })}
      {/* Kept in one order so each player glides from frame to frame. */}
      {[...OFFENSE, ...DEFENSE].map((pid) => {
        const s = at(pid);
        return s ? <Player key={pid} spot={s} ball={frame.ball === pid} moving={moving} /> : null;
      })}
    </svg>
  );
}

// A drawn play, read-only: its frames one at a time (‹ › to step), and ▶ to watch the players move through them.
export function PlayViewer({ frames, name }: { frames: Frame[]; name: string }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setI((n) => {
        if (n >= frames.length - 1) {
          setPlaying(false);
          return n;
        }
        return n + 1;
      });
    }, 1500);
    return () => clearInterval(t);
  }, [playing, frames.length]);
  if (!frames.length) return null;
  const at = Math.min(i, frames.length - 1);
  return (
    <div className="space-y-2">
      <Court frame={frames[at]} moving label={`${name}, frame ${at + 1} of ${frames.length}`} />
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Back a frame" disabled={at === 0} onClick={() => setI(at - 1)} className={`${chip(false)} disabled:opacity-40`}>
            ‹
          </button>
          <span className="w-20 text-center text-zinc-500">
            Frame {at + 1} of {frames.length}
          </span>
          <button
            type="button"
            aria-label="Next frame"
            disabled={at === frames.length - 1}
            onClick={() => setI(at + 1)}
            className={`${chip(false)} disabled:opacity-40`}
          >
            ›
          </button>
        </div>
        {frames.length > 1 && (
          <button
            type="button"
            onClick={() => {
              if (playing) return setPlaying(false);
              if (at === frames.length - 1) setI(0);
              setPlaying(true);
            }}
            className={chip(playing)}
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
        )}
      </div>
    </div>
  );
}

type Tool = "move" | LineKind | "ball" | "erase";
// Offense's tools (blue), then defense's (red; X1–X5 only).
const TOOLS: { key: Tool; label: string }[] = [
  { key: "move", label: "Move" },
  { key: "cut", label: "Cut" },
  { key: "dribble", label: "Dribble" },
  { key: "pass", label: "Pass" },
  { key: "screen", label: "Screen" },
  { key: "ball", label: "Ball" },
  { key: "erase", label: "Erase" },
];
const D_TOOLS: { key: Tool; label: string }[] = [
  { key: "slide", label: "Slide" },
  { key: "closeout", label: "Close out" },
  { key: "trap", label: "Trap" },
  { key: "deny", label: "Deny" },
  { key: "switch", label: "Switch" },
];
const dChip = (on: boolean) =>
  `rounded-full px-3 py-1 text-sm font-medium ring-1 ${on ? "bg-red-600 text-white ring-red-600" : "text-red-700 ring-red-600/30 dark:text-red-300 dark:ring-red-400/30"}`;
const HINT: Record<Tool, string> = {
  move: "Drag a player to where they start this frame.",
  cut: "Drag from a player to where they cut.",
  dribble: "Drag from the player with the ball to where they dribble.",
  pass: "Drag from the player with the ball to where the pass goes.",
  screen: "Drag from a player to where they set the screen.",
  ball: "Tap the player who has the ball.",
  erase: "Tap a line to erase it.",
  slide: "Drag from a defender to where they slide, help or rotate.",
  closeout: "Drag from a defender to the shooter they close out on.",
  trap: "Drag from a defender to where they trap the ball.",
  deny: "Drag from a defender to the spot in the passing lane where they deny.",
  switch: "Drag from a defender to the player they switch onto.",
};

// Distance from a point to a line segment.
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Drawing a play: pick a tool, then drag on the court. Frames: each new one starts where the last one ends (players at
// their lines' ends, the ball with whoever it was passed to). Players on and off the court by number.
export function PlayEditor({ frames, onChange }: { frames: Frame[]; onChange: (f: Frame[]) => void }) {
  const [at, setAt] = useState(0);
  // ▶ Play: runs through the frames from 1, the players gliding from each to the next (drawing waits until it ends).
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setAt((n) => {
        if (n >= frames.length - 1) {
          setPlaying(false);
          return n;
        }
        return n + 1;
      });
    }, 1500);
    return () => clearInterval(t);
  }, [playing, frames.length]);
  const [tool, setTool] = useState<Tool>("cut");
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null);
  const [bending, setBending] = useState<number | null>(null); // Curve: the line being bent
  const [msg, setMsg] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const i = Math.min(at, frames.length - 1);
  const frame = frames[i];
  const setFrame = (f: Frame) => onChange(frames.map((x, n) => (n === i ? f : x)));

  const point = (e: ReactPointerEvent<SVGSVGElement>) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.min(COURT_W, Math.max(0, p.x)), y: Math.min(COURT_H, Math.max(0, p.y)) };
  };
  const playerAt = (x: number, y: number) =>
    frame.spots
      .map((s) => ({ s, d: Math.hypot(s.x - x, s.y - y) }))
      .filter((o) => o.d < R + 16)
      .sort((a, b) => a.d - b.d)[0]?.s ?? null;

  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (playing) return;
    setMsg(null);
    const p = point(e);
    // The line nearest the tap (straight or curved), within reach.
    const lineHit = () => {
      const hit = frame.lines
        .map((l, n) => {
          const f = frame.spots.find((s) => s.id === l.from);
          return { n, d: f ? lineDistance(f, l, p.x, p.y) : Infinity };
        })
        .sort((a, b) => a.d - b.d)[0];
      return hit && hit.d < 22 ? hit.n : null;
    };
    if (tool === "erase") {
      const n = lineHit();
      if (n !== null) setFrame({ ...frame, lines: frame.lines.filter((_, k) => k !== n) });
      return;
    }
    const who = playerAt(p.x, p.y);
    if (!who) {
      // Not on a player: dragging a line (any tool) bends it into a curve; a pass stays straight.
      const n = lineHit();
      if (n === null || !canCurve(frame.lines[n].kind)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      return setBending(n);
    }
    if (tool === "ball") {
      if (!isOffense(who.id)) return setMsg("The ball goes to an offensive player (1–5).");
      return setFrame({ ...frame, ball: who.id });
    }
    const lineTool = tool !== "move";
    if (lineTool && isDefenseLine(tool as LineKind) && isOffense(who.id)) return setMsg("Defensive actions are for X1–X5.");
    if (lineTool && !isDefenseLine(tool as LineKind) && !isOffense(who.id)) return setMsg("Offensive actions are for 1–5. Pick a red Defense action.");
    if ((tool === "pass" || tool === "dribble") && frame.ball !== who.id) return setMsg(`Only the player with the ball can ${tool}.`);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: who.id, x: p.x, y: p.y });
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (bending !== null) {
      const p = point(e);
      const l = frame.lines[bending];
      const f = l && frame.spots.find((s) => s.id === l.from);
      if (!l || !f) return;
      // Close to the straight line: straight again.
      const { bx: _x, by: _y, ...plain } = l;
      void _x;
      void _y;
      const straight = segDist(p.x, p.y, f.x, f.y, l.x, l.y) < 8;
      const next = straight ? plain : { ...plain, bx: Math.round(p.x), by: Math.round(p.y) };
      return setFrame({ ...frame, lines: frame.lines.map((x, n) => (n === bending ? next : x)) });
    }
    if (!drag) return;
    const p = point(e);
    if (tool === "move") setFrame({ ...frame, spots: frame.spots.map((s) => (s.id === drag.from ? { ...s, x: Math.round(p.x), y: Math.round(p.y) } : s)) });
    setDrag({ ...drag, x: p.x, y: p.y });
  };
  const up = () => {
    if (bending !== null) return setBending(null);
    if (!drag) return;
    const from = frame.spots.find((s) => s.id === drag.from);
    if (tool !== "move" && from && Math.hypot(drag.x - from.x, drag.y - from.y) > R + 10) {
      if (frame.lines.length >= MAX_LINES) setMsg(`Up to ${MAX_LINES} lines in a frame.`);
      else setFrame({ ...frame, lines: [...frame.lines, { kind: tool as LineKind, from: drag.from, x: Math.round(drag.x), y: Math.round(drag.y) }] });
    }
    setDrag(null);
  };

  // Players on and off the court (a defender starts between their player and the basket).
  const toggle = (pid: string) => {
    const on = frame.spots.some((s) => s.id === pid);
    if (on)
      return setFrame({
        spots: frame.spots.filter((s) => s.id !== pid),
        ball: frame.ball === pid ? null : frame.ball,
        lines: frame.lines.filter((l) => l.from !== pid),
      });
    const spot = isOffense(pid) ? { id: pid, x: 250, y: 300 } : defenderSpot(frame, pid);
    setFrame({ ...frame, spots: [...frame.spots, spot] });
  };
  const dragFrom = drag && tool !== "move" ? frame.spots.find((s) => s.id === drag.from) : null;
  const small = (on: boolean, red = false) =>
    `min-w-8 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${
      on
        ? red
          ? "bg-red-600 text-white ring-red-600"
          : "bg-thunder-blue text-white ring-thunder-blue"
        : "text-zinc-500 ring-zinc-950/15 dark:ring-white/20"
    }`;

  return (
    <div className="space-y-2">
      {/* Frames: 1, 2, 3 … and + Next frame (starts where this one ends). */}
      <div className="flex flex-wrap items-center gap-1.5">
        {frames.map((_, n) => (
          <button key={n} type="button" aria-pressed={n === i} onClick={() => setAt(n)} className={chip(n === i)}>
            {n + 1}
          </button>
        ))}
        {frames.length < MAX_FRAMES && (
          <button
            type="button"
            onClick={() => {
              const next = nextFrame(frames[frames.length - 1]);
              onChange([...frames, next]);
              setAt(frames.length);
            }}
            className="rounded-full px-3 py-1 text-sm font-medium text-thunder-blue ring-1 ring-thunder-blue/40"
          >
            + Next frame
          </button>
        )}
        {frames.length > 1 && (
          <button
            type="button"
            onClick={() => {
              if (playing) return setPlaying(false);
              setAt(0);
              setDrag(null);
              // Start from frame 1, then move on (a moment later, so frame 1 shows first).
              setTimeout(() => setPlaying(true), 50);
            }}
            className={`ml-auto ${chip(playing)}`}
          >
            {playing ? "❚❚ Stop" : "▶ Play"}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TOOLS.map((t) => (
          <button key={t.key} type="button" aria-pressed={tool === t.key} onClick={() => setTool(t.key)} className={chip(tool === t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-red-700 dark:text-red-300">Defense</span>
        {D_TOOLS.map((t) => (
          <button key={t.key} type="button" aria-pressed={tool === t.key} onClick={() => setTool(t.key)} className={dChip(tool === t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-500">
        {HINT[tool]}
        {tool !== "erase" && tool !== "ball" && " Drag a line's dot to curve it (back to straight to undo)."}
      </p>
      <Court
        frame={frame}
        svgRef={svg}
        moving={playing}
        touchNone
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        label={`Drawing frame ${i + 1} of ${frames.length}`}
        preview={dragFrom && drag ? { kind: tool as LineKind, from: drag.from, x: drag.x, y: drag.y } : null}
        handles={!playing}
      />
      {msg && <p className="text-xs font-medium text-red-600 dark:text-red-400">{msg}</p>}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-zinc-500">On court</span>
        {OFFENSE.map((pid) => (
          <button key={pid} type="button" onClick={() => toggle(pid)} aria-pressed={frame.spots.some((s) => s.id === pid)} className={small(frame.spots.some((s) => s.id === pid))}>
            {pid}
          </button>
        ))}
        {DEFENSE.map((pid) => (
          <button
            key={pid}
            type="button"
            onClick={() => toggle(pid)}
            aria-pressed={frame.spots.some((s) => s.id === pid)}
            className={small(frame.spots.some((s) => s.id === pid), true)}
          >
            {pid}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-sm font-medium">
        <button
          type="button"
          disabled={!frame.lines.length}
          onClick={() => setFrame({ ...frame, lines: frame.lines.slice(0, -1) })}
          className="text-thunder-blue hover:underline disabled:opacity-40"
        >
          Undo line
        </button>
        {frames.length > 1 && (
          <button
            type="button"
            onClick={() => {
              onChange(frames.filter((_, n) => n !== i));
              setAt(Math.max(0, i - 1));
            }}
            className="text-red-600 hover:underline dark:text-red-400"
          >
            Delete frame {i + 1}
          </button>
        )}
      </div>
    </div>
  );
}

export { startFrame };
