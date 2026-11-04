import { describe, expect, it } from "vitest";
import { planMatchups, type MatchTeam } from "./scenic-matchups";

const t = (id: string, need = 1, club = id, grade = 4, level = "REC"): MatchTeam => ({ id, need, club, grade, level });
const k = (a: string, b: string) => (Number(a) < Number(b) ? `${a}-${b}` : `${b}-${a}`);
const pairs = (p: { pairs: [string, string][] }) => p.pairs.map(([a, b]) => k(a, b)).sort();

describe("planning matchups", () => {
  it("gives every team its games guaranteed, never the same pair twice in a day", () => {
    const p = planMatchups([t("1", 2), t("2", 2), t("3", 2), t("4", 2)], new Map());
    expect(p.short).toEqual([]);
    expect(pairs(p)).toHaveLength(4);
    expect(new Set(pairs(p)).size).toBe(4);
    for (const id of ["1", "2", "3", "4"]) expect(p.pairs.filter((x) => x.includes(id))).toHaveLength(2);
  });

  it("keeps pairs new: avoids teams that already met on another Game Day", () => {
    const met = new Map([
      [k("1", "2"), 1],
      [k("3", "4"), 1],
    ]);
    expect(pairs(planMatchups([t("1"), t("2"), t("3"), t("4")], met))).not.toContain(k("1", "2"));
    expect(pairs(planMatchups([t("1"), t("2"), t("3"), t("4")], met))).not.toContain(k("3", "4"));
  });

  it("prefers another club, then the same grade group", () => {
    const p = planMatchups([t("1", 1, "Baylor"), t("2", 1, "Baylor"), t("3", 1, "GPS"), t("4", 1, "GPS")], new Map());
    expect(pairs(p)).not.toContain(k("1", "2"));
    expect(pairs(planMatchups([t("1", 1, "a", 3), t("2", 1, "b", 4), t("3", 1, "c", 3), t("4", 1, "d", 4)], new Map()))).toEqual(
      [k("1", "3"), k("2", "4")].sort(),
    );
  });

  it("an odd number of games leaves one team short", () => {
    const p = planMatchups([t("1"), t("2"), t("3")], new Map());
    expect(p.pairs).toHaveLength(1);
    expect(p.short).toHaveLength(1);
    // Two teams can't play each other twice the same day.
    expect(planMatchups([t("1", 2), t("2", 2)], new Map()).short).toEqual([
      { id: "1", games: 1 },
      { id: "2", games: 1 },
    ]);
  });
});
