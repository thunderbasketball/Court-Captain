// CourtPlaybook diagrams (browser-safe; SPEC.md section 14): a play drawn on a high school half court, in frames. Court
// units are tenths of a foot: 500 wide (50 ft) by 420 deep (42 ft), the baseline at the top (y = 0), the basket's
// center 5 ft 3 in from it.
// Each frame has its players (offense 1–5, defense X1–X5) where they stand, who has the ball, and its lines from
// players: a cut, pass, dribble or screen, each ending at a point.

export const COURT_W = 500;
export const COURT_H = 420;
export const BASKET = { x: 250, y: 52.5 };
export const OFFENSE = ["1", "2", "3", "4", "5"] as const;
export const DEFENSE = ["X1", "X2", "X3", "X4", "X5"] as const;
export const PLAYER_IDS: readonly string[] = [...OFFENSE, ...DEFENSE];
// Offense (1–5): cut, dribble, pass, screen. Defense (X1–X5): slide (move, help, rotate), close out, trap, deny (into
// the passing lane) and switch.
export const OFFENSE_LINES = ["cut", "dribble", "pass", "screen"] as const;
export const DEFENSE_LINES = ["slide", "closeout", "trap", "deny", "switch"] as const;
export const LINE_KINDS = [...OFFENSE_LINES, ...DEFENSE_LINES] as const;
export type LineKind = (typeof LINE_KINDS)[number];
export const isDefenseLine = (k: LineKind) => (DEFENSE_LINES as readonly string[]).includes(k);
// The lines that move their player to its end (all but a pass).
const MOVES = (k: LineKind) => k !== "pass";

export type Spot = { id: string; x: number; y: number };
export type PlayLine = { kind: LineKind; from: string; x: number; y: number };
export type Frame = { spots: Spot[]; ball: string | null; lines: PlayLine[] };

export const MAX_FRAMES = 12;
export const MAX_LINES = 20;

const clampX = (v: number) => Math.min(COURT_W, Math.max(0, Math.round(v)));
const clampY = (v: number) => Math.min(COURT_H, Math.max(0, Math.round(v)));
export const isOffense = (id: string) => (OFFENSE as readonly string[]).includes(id);

// The usual start: 1 at the top with the ball, 2 and 3 on the wings, 4 and 5 on the blocks.
const START: Record<string, [number, number]> = { "1": [250, 320], "2": [430, 230], "3": [70, 230], "4": [335, 110], "5": [165, 110] };
export function startFrame(): Frame {
  return { spots: OFFENSE.map((id) => ({ id, x: START[id][0], y: START[id][1] })), ball: "1", lines: [] };
}

// Where a defender starts: between their player and the basket (or the top of the key without one).
export function defenderSpot(frame: Frame, id: string): Spot {
  const mine = frame.spots.find((s) => s.id === id.slice(1));
  if (!mine) return { id, x: 250, y: 230 };
  const dx = BASKET.x - mine.x;
  const dy = BASKET.y - mine.y;
  const len = Math.hypot(dx, dy) || 1;
  return { id, x: clampX(mine.x + (dx / len) * 40), y: clampY(mine.y + (dy / len) * 40) };
}

// The next frame starts where this one ends: whoever cut, dribbled or screened stands at their line's end, and a pass
// gives the ball to the offensive player nearest where it ends. Its lines start empty.
export function nextFrame(f: Frame): Frame {
  const spots = f.spots.map((s) => {
    const moves = f.lines.filter((l) => l.from === s.id && MOVES(l.kind));
    const last = moves[moves.length - 1];
    return last ? { ...s, x: last.x, y: last.y } : { ...s };
  });
  let ball = f.ball;
  const pass = [...f.lines].reverse().find((l) => l.kind === "pass" && l.from === f.ball);
  if (pass) {
    const near = spots
      .filter((s) => isOffense(s.id) && s.id !== pass.from)
      .map((s) => ({ id: s.id, d: Math.hypot(s.x - pass.x, s.y - pass.y) }))
      .sort((a, b) => a.d - b.d)[0];
    if (near) ball = near.id;
  }
  return { spots, ball, lines: [] };
}

// A diagram from the browser, checked: up to 12 frames; each player once, on the court; the ball with an offensive
// player who's there (or no one); up to 20 lines, each from a player who's there and ending on the court. A message
// when something's wrong.
export function cleanFrames(v: unknown): Frame[] | string {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_FRAMES) return `A play can have up to ${MAX_FRAMES} frames.`;
  const out: Frame[] = [];
  const num = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  for (const [i, f] of v.entries()) {
    const where = `Frame ${i + 1}`;
    if (!f || typeof f !== "object" || !Array.isArray(f.spots) || !Array.isArray(f.lines)) return `${where} isn't readable.`;
    const spots: Spot[] = [];
    for (const s of f.spots) {
      if (!s || !PLAYER_IDS.includes(s.id) || !num(s.x) || !num(s.y)) return `${where}: a player isn't readable.`;
      if (spots.some((x) => x.id === s.id)) return `${where}: ${s.id} is on the court twice.`;
      spots.push({ id: s.id, x: clampX(s.x), y: clampY(s.y) });
    }
    const ball = f.ball === null || f.ball === undefined ? null : String(f.ball);
    if (ball !== null && !(isOffense(ball) && spots.some((s) => s.id === ball))) return `${where}: the ball must be with an offensive player.`;
    if (f.lines.length > MAX_LINES) return `${where}: up to ${MAX_LINES} lines.`;
    const lines: PlayLine[] = [];
    for (const l of f.lines) {
      if (!l || !(LINE_KINDS as readonly string[]).includes(l.kind) || !num(l.x) || !num(l.y)) return `${where}: a line isn't readable.`;
      if (!spots.some((s) => s.id === l.from)) return `${where}: a line starts from a player who isn't there.`;
      if (isDefenseLine(l.kind) === isOffense(l.from))
        return `${where}: ${isOffense(l.from) ? "defensive actions are for X1–X5" : "offensive actions are for 1–5"}.`;
      lines.push({ kind: l.kind, from: l.from, x: clampX(l.x), y: clampY(l.y) });
    }
    out.push({ spots, ball, lines });
  }
  return out;
}
