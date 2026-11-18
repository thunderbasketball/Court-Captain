// CourtPlaybook Base Formations (browser-safe; rules in lib/playbook.ts): where the players stand when an Offense or
// Defense play starts. Common ones are built in; a playbook adds its own (a built-in's name replaces it there).
// Court: 500 wide, 420 deep, baseline at the top (10 units a foot); basket (250, 52.5); free-throw line y 190;
// 3-point arc's top y 250, its corners at x 30 / 470.
import { defenderSpot, startFrame, type Frame, type Spot } from "./play-diagram";

export const FORMATION_KINDS = ["Offense", "Defense"] as const;
export type FormationKind = (typeof FORMATION_KINDS)[number];
export type Formation = { id: string | null; kind: FormationKind; name: string; spots: Frame; addedBy: string | null; changedBy: string | null };

const at = (list: [string, number, number][]): Spot[] => list.map(([id, x, y]) => ({ id, x, y }));
const offense = (list: [string, number, number][]): Frame => ({ spots: at(list), ball: "1", lines: [] });
const defense = (list: [string, number, number][]): Frame => ({ spots: at(list), ball: null, lines: [] });
// Man-to-Man: the usual offense, each defender between their player and the basket.
const man = (): Frame => {
  const f = startFrame();
  return { ...f, spots: [...f.spots, ...f.spots.map((s) => defenderSpot(f, `X${s.id}`))] };
};

export const BUILT_IN: { kind: FormationKind; name: string; spots: Frame }[] = [
  { kind: "Offense", name: "5-Out", spots: offense([["1", 250, 320], ["2", 430, 230], ["3", 70, 230], ["4", 470, 45], ["5", 30, 45]]) },
  { kind: "Offense", name: "4-Out 1-In", spots: offense([["1", 250, 320], ["2", 430, 230], ["3", 70, 230], ["4", 470, 45], ["5", 180, 95]]) },
  { kind: "Offense", name: "Horns", spots: offense([["1", 250, 320], ["2", 470, 45], ["3", 30, 45], ["4", 310, 190], ["5", 190, 190]]) },
  { kind: "Offense", name: "1-4 High", spots: offense([["1", 250, 320], ["2", 440, 190], ["3", 60, 190], ["4", 310, 190], ["5", 190, 190]]) },
  { kind: "Offense", name: "1-3-1", spots: offense([["1", 250, 320], ["2", 430, 200], ["3", 70, 200], ["4", 250, 190], ["5", 330, 40]]) },
  { kind: "Defense", name: "Man-to-Man", spots: man() },
  { kind: "Defense", name: "2-3 Zone", spots: defense([["X1", 195, 245], ["X2", 305, 245], ["X3", 400, 110], ["X4", 100, 110], ["X5", 250, 85]]) },
  { kind: "Defense", name: "3-2 Zone", spots: defense([["X1", 250, 270], ["X2", 395, 215], ["X3", 105, 215], ["X4", 320, 95], ["X5", 180, 95]]) },
  { kind: "Defense", name: "1-3-1 Zone", spots: defense([["X1", 250, 290], ["X2", 390, 180], ["X3", 110, 180], ["X4", 250, 175], ["X5", 250, 65]]) },
  { kind: "Defense", name: "1-2-2 Zone", spots: defense([["X1", 250, 300], ["X2", 375, 230], ["X3", 125, 230], ["X4", 340, 100], ["X5", 160, 100]]) },
];

// A playbook's formations for one kind: the built-ins (its own with the same name replacing them), then its own, then
// any name its plays use that isn't either (a copied play's), each with no spots of its own (the usual start).
export function formationsFor(kind: FormationKind, own: Formation[], used: string[] = []): Formation[] {
  const mine = own.filter((f) => f.kind === kind);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const out: Formation[] = BUILT_IN.filter((b) => b.kind === kind).map(
    (b) => mine.find((f) => same(f.name, b.name)) ?? { id: null, kind, name: b.name, spots: b.spots, addedBy: null, changedBy: null },
  );
  for (const f of mine) if (!out.some((o) => same(o.name, f.name))) out.push(f);
  for (const n of used)
    if (!out.some((o) => same(o.name, n))) out.push({ id: null, kind, name: n, spots: kind === "Offense" ? startFrame() : man(), addedBy: null, changedBy: null });
  return out;
}

export const isBuiltIn = (kind: FormationKind, name: string) => BUILT_IN.some((b) => b.kind === kind && b.name.toLowerCase() === name.toLowerCase());
// A copy of a formation's spots, as a play's first frame.
export const fromFormation = (f: Formation): Frame => ({ spots: f.spots.spots.map((s) => ({ ...s })), ball: f.spots.ball, lines: [] });
