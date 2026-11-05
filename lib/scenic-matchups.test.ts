import { describe, expect, it } from "vitest";
import { assignHome, planMatchups, type HomeTeam, type MatchTeam } from "./scenic-matchups";

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

  it("same organization only when nothing else is left, even if other pairs are further apart in grade", () => {
    // Pairing across organizations costs grade differences; pairing X with X costs nothing else.
    const teams = [t("1", 1, "X", 3), t("2", 1, "X", 3), t("3", 1, "Y", 6), t("4", 1, "Z", 6)];
    expect(pairs(planMatchups(teams, new Map()))).not.toContain(k("1", "2"));
    // Once both X teams have met Y and Z on other Game Days, X vs X (new) comes before a repeat.
    const met = new Map([k("1", "3"), k("1", "4"), k("2", "3"), k("2", "4")].map((x) => [x, 1]));
    expect(pairs(planMatchups(teams, met))).toEqual([k("1", "2"), k("3", "4")].sort());
  });

  it("never pairs a REC team with a COMP team, even if that leaves teams short", () => {
    const p = planMatchups([t("1", 1, "X", 4, "REC"), t("2", 1, "Y", 4, "COMP"), t("3", 1, "Z", 4, "REC")], new Map());
    expect(pairs(p)).toEqual([k("1", "3")]);
    expect(p.short).toEqual([{ id: "2", games: 1 }]);
    const alone = planMatchups([t("1", 1, "X", 4, "REC"), t("2", 1, "Y", 4, "COMP")], new Map());
    expect(alone.pairs).toEqual([]);
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

  it("leaves short (to play TBD) a team that hasn't played TBD this season", () => {
    for (let i = 0; i < 5; i++) {
      const teams = [t("1"), t("2"), t("3")].map((x, j) => ({ ...x, hadTbd: j !== i % 3 }));
      expect(planMatchups(teams, new Map()).short).toEqual([{ id: String((i % 3) + 1), games: 1 }]);
    }
  });

  it("home and away: alternates each team, then about half of each organization's games at home", () => {
    const h = (club: string, last: HomeTeam["last"] = null, homeGames = 0): HomeTeam => ({ club, last, homeGames });
    // Home last time means away now (and away means home), whichever side it's on.
    const teams = new Map([
      ["1", h("X", "H")],
      ["2", h("Y", "A")],
      ["3", h("X", "A")],
      ["4", h("Y", "H")],
    ]);
    expect(
      assignHome(
        [
          { a: "1", b: "2" },
          { a: "3", b: "4" },
        ],
        teams,
      ),
    ).toEqual(["b", "a"]);
    // TBD: the team alone; away last time, so home now.
    expect(assignHome([{ a: "3", b: null }], teams)).toEqual(["a"]);
    // No history: each organization gets half its games at home.
    const fresh = new Map(["1", "2", "3", "4", "5", "6", "7", "8"].map((id) => [id, h(Number(id) <= 4 ? "X" : "Y")]));
    const games = [
      { a: "1", b: "5" },
      { a: "2", b: "6" },
      { a: "3", b: "7" },
      { a: "4", b: "8" },
    ];
    const sides = assignHome(games, fresh);
    expect(sides.filter((x) => x === "a")).toHaveLength(2);
    // Counting the organization's games already set in other divisions that day (X already has 3 at home, 0 away), Y
    // gets the home games.
    const today = new Map([["X", { home: 3, total: 3 }]]);
    expect(assignHome(games, fresh, today).filter((x) => x === "a")).toHaveLength(1);
    // A side kept from before isn't changed.
    expect(assignHome([{ a: "1", b: "2", fixed: "a" }], teams)).toEqual(["a"]);
  });

  it("a coach with several teams: all home or all away, even over alternating", () => {
    const h = (club: string, last: HomeTeam["last"], coach?: string): HomeTeam => ({ club, last, homeGames: 0, coach });
    // Coach C has teams 1 and 3. Team 1 was away last time (so home now); team 3 was home last time but goes with it.
    const teams = new Map([
      ["1", h("X", "A", "C")],
      ["2", h("Y", null)],
      ["3", h("X", "H", "C")],
      ["4", h("Y", null)],
    ]);
    const games = [
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ];
    expect(assignHome(games, teams)).toEqual(["a", "a"]);
    // The coach's team in another division is already away today: this one is away too.
    expect(assignHome([{ a: "1", b: "2" }], teams, new Map(), new Map([["C", "A"]]))).toEqual(["b"]);
  });

  it("a coach's teams play the same organization where they can", () => {
    // Coach C's other team plays GPS today; team 1 (C's) picks the GPS team over the others of the same grade.
    const teams = [{ ...t("1", 1, "McCallie"), coach: "C" }, t("2", 1, "Baylor"), t("3", 1, "GPS"), t("4", 1, "Lookout")];
    const p = planMatchups(teams, new Map(), 300, new Map([["C", new Set(["GPS"])]]));
    expect(pairs(p)).toContain(k("1", "3"));
    // Without the coach's other game, nothing prefers GPS, but every team still gets its game.
    expect(planMatchups(teams, new Map()).short).toEqual([]);
  });
});
