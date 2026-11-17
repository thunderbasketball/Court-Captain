import { describe, expect, it } from "vitest";
import { cleanFrames, defenderSpot, lineDistance, linePoint, movingLine, nextFrame, startFrame, type Frame } from "./play-diagram";

describe("CourtPlaybook diagrams", () => {
  it("starts with 1–5 in their spots and the ball with 1", () => {
    const f = startFrame();
    expect(f.spots.map((s) => s.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(f.ball).toBe("1");
    expect(f.lines).toEqual([]);
  });

  it("a defender starts between their player and the basket", () => {
    const s = defenderSpot(startFrame(), "X1"); // 1 at (250, 320): straight up toward the basket
    expect(s).toEqual({ id: "X1", x: 250, y: 280 });
  });

  it("the next frame starts where this one ends: cutters, dribblers and screeners moved; a pass gives the ball", () => {
    const f: Frame = {
      ...startFrame(),
      lines: [
        { kind: "pass", from: "1", x: 425, y: 235 }, // to 2
        { kind: "cut", from: "1", x: 250, y: 100 },
        { kind: "screen", from: "4", x: 380, y: 250 },
      ],
    };
    const n = nextFrame(f);
    expect(n.ball).toBe("2");
    expect(n.spots.find((s) => s.id === "1")).toEqual({ id: "1", x: 250, y: 100 });
    expect(n.spots.find((s) => s.id === "4")).toEqual({ id: "4", x: 380, y: 250 });
    expect(n.spots.find((s) => s.id === "2")).toEqual({ id: "2", x: 430, y: 230 }); // didn't move
    expect(n.lines).toEqual([]);
    // A pass from someone without the ball doesn't move it.
    expect(nextFrame({ ...startFrame(), lines: [{ kind: "pass", from: "3", x: 420, y: 290 }] }).ball).toBe("1");
  });

  it("defense: X1–X5 slide, close out, trap, deny and switch to their line's end", () => {
    const f: Frame = { ...startFrame(), spots: [...startFrame().spots, { id: "X1", x: 250, y: 280 }, { id: "X2", x: 400, y: 200 }, { id: "X3", x: 100, y: 200 }] };
    const n = nextFrame({
      ...f,
      lines: [
        { kind: "trap", from: "X1", x: 260, y: 310 },
        { kind: "deny", from: "X2", x: 410, y: 260 },
        { kind: "closeout", from: "X3", x: 80, y: 225 },
      ],
    });
    expect(n.spots.find((s) => s.id === "X1")).toMatchObject({ x: 260, y: 310 });
    expect(n.spots.find((s) => s.id === "X2")).toMatchObject({ x: 410, y: 260 }); // into the passing lane
    expect(n.spots.find((s) => s.id === "X3")).toMatchObject({ x: 80, y: 225 });
    // Defensive actions are for X1–X5; offensive ones for 1–5.
    expect(cleanFrames([{ ...f, lines: [{ kind: "slide", from: "1", x: 1, y: 1 }] }])).toMatch(/X1–X5/);
    expect(cleanFrames([{ ...f, lines: [{ kind: "cut", from: "X1", x: 1, y: 1 }] }])).toMatch(/1–5/);
    expect(cleanFrames([{ ...f, lines: [{ kind: "switch", from: "X1", x: 1, y: 1 }] }])).not.toBeTypeOf("string");
  });

  it("checks what the browser sends", () => {
    expect(cleanFrames(undefined)).toEqual([]);
    const ok = cleanFrames([{ ...startFrame(), lines: [{ kind: "cut", from: "2", x: 600.4, y: -5 }] }]) as Frame[];
    expect(ok[0].lines[0]).toEqual({ kind: "cut", from: "2", x: 500, y: 0 }); // kept on the court
    expect(cleanFrames(Array.from({ length: 13 }, startFrame))).toMatch(/up to 12/);
    expect(cleanFrames([{ ...startFrame(), spots: [{ id: "6", x: 1, y: 1 }] }])).toMatch(/player/);
    expect(cleanFrames([{ ...startFrame(), spots: [...startFrame().spots, { id: "1", x: 1, y: 1 }] }])).toMatch(/twice/);
    expect(cleanFrames([{ ...startFrame(), ball: "X1" }])).toMatch(/ball/);
    expect(cleanFrames([{ ...startFrame(), lines: [{ kind: "lob", from: "1", x: 1, y: 1 }] }])).toMatch(/line/);
    expect(cleanFrames([{ ...startFrame(), lines: [{ kind: "cut", from: "X3", x: 1, y: 1 }] }])).toMatch(/isn't there/);
    expect(cleanFrames([{ ...startFrame(), lines: Array.from({ length: 21 }, () => ({ kind: "cut", from: "1", x: 1, y: 1 })) }])).toMatch(/20 lines/);
    expect(cleanFrames("<script>")).toMatch(/frames/);
  });

  it("curved lines: bent through a point, kept on the court, measured for tapping", () => {
    const f = startFrame();
    const kept = cleanFrames([{ ...f, lines: [{ kind: "cut", from: "1", x: 400, y: 100, bx: 900, by: 250.6 }] }]) as Frame[];
    expect(kept[0].lines[0]).toEqual({ kind: "cut", from: "1", x: 400, y: 100, bx: 500, by: 251 });
    expect(cleanFrames([{ ...f, lines: [{ kind: "cut", from: "1", x: 4, y: 1, bx: "a", by: 2 }] }])).toMatch(/curved/);
    const pass = cleanFrames([{ ...f, lines: [{ kind: "pass", from: "1", x: 400, y: 100, bx: 300, by: 250 }] }]) as Frame[];
    expect(pass[0].lines[0]).toEqual({ kind: "pass", from: "1", x: 400, y: 100 }); // a pass stays straight
    const from = { x: 100, y: 300 };
    const l = { kind: "cut" as const, from: "1", x: 300, y: 300, bx: 200, by: 200 };
    expect(linePoint(from, l, 0.5)).toEqual({ x: 200, y: 200 }); // passes through its bend point
    expect(linePoint(from, l, 1)).toEqual({ x: 300, y: 300 });
    expect(lineDistance(from, l, 200, 205)).toBeLessThan(6);
    expect(lineDistance(from, { ...l, bx: undefined, by: undefined }, 200, 205)).toBeGreaterThan(90); // straight: far
    expect(nextFrame({ ...f, lines: [{ ...l, from: "1" }] }).spots.find((s) => s.id === "1")).toMatchObject({ x: 300, y: 300 });
    // ▶ Play carries each player along the line that moved them (their last one); a pass moves no one.
    const g = { ...f, lines: [{ kind: "pass" as const, from: "1", x: 430, y: 230 }, { ...l, from: "2" }, { kind: "dribble" as const, from: "1", x: 250, y: 200 }] };
    expect(movingLine(g, "1")).toMatchObject({ kind: "dribble" });
    expect(movingLine(g, "2")).toMatchObject({ bx: 200, by: 200 });
    expect(movingLine(g, "3")).toBeNull();
  });
});
