import { describe, expect, it } from "vitest";
import { hostRoom, hostShares, planOrder } from "./host-room";
import { assignHome, homeCost, planMatchups, type HomeTeam, type MatchTeam } from "./scenic-matchups";

const t = (id: string, need = 1, club = id, grade = 4, level = "REC"): MatchTeam => ({ id, need, club, grade, level });
const k = (a: string, b: string) => (Number(a) < Number(b) ? `${a}-${b}` : `${b}-${a}`);
const pairs = (p: { pairs: [string, string][] }) => p.pairs.map(([a, b]) => k(a, b)).sort();

describe("how many home games a host has room for", () => {
  const courts = [
    { id: "any", hostId: "H", slots: 3, divisions: null },
    { id: "young", hostId: "H", slots: 2, divisions: ["d1"] },
    { id: "er", hostId: "E", slots: 5, divisions: null },
  ];
  it("its open slots for the division, less its other teams' games, on the court with fewer divisions first", () => {
    expect([...hostRoom(courts, [], "d1")]).toEqual([["H", 5], ["E", 5]]);
    expect(hostRoom(courts, [], "d2").get("H")).toBe(3);
    expect(hostRoom(courts, [{ hostId: "H", divisionId: "d1" }, { hostId: "H", divisionId: "d1" }], "d2").get("H")).toBe(3); // on "young"
    expect(hostRoom(courts, [{ hostId: "H", divisionId: "d2" }, { hostId: "H", divisionId: "d2" }], "d1").get("H")).toBe(3);
    expect(hostRoom(courts, [{ hostId: "E", divisionId: "d1", court: "any" }], "d2").get("H")).toBe(2); // another's game placed there
    expect(hostRoom(courts, Array.from({ length: 99 }, () => ({ hostId: "H", divisionId: "d2" })), "d2").get("H")).toBe(0);
    expect(hostRoom(courts, [{ hostId: null, divisionId: "d2" }], "d2").get("E")).toBe(5);
  });
  it("shares: in each group about half of each host's teams' games at home, then even over the day", () => {
    const group = (id: string, divisionId: string, games: number, need: Record<string, number>) => ({ id, divisionId, games, need: new Map(Object.entries(need)) });
    // City's one court takes only d1 (6 slots); Thunder's takes any. In d1 each about half its teams' games (City 7, T 5: a tie
    // for the last one, given to City, which has no home games in d2); d2 all Thunder's (City can't host it).
    const two = [{ id: "c", hostId: "City", slots: 6, divisions: ["d1"] }, { id: "t", hostId: "T", slots: 20, divisions: null }];
    const groups = [group("d1", "d1", 6, { City: 7, T: 5 }), group("d2", "d2", 6, { City: 8, T: 6 })];
    let s = hostShares(two, [], new Map(), groups);
    expect([s.get("d1")!.get("City"), s.get("d1")!.get("T") ?? 0, s.get("d2")!.get("City") ?? 0, s.get("d2")!.get("T")]).toEqual([4, 2, 0, 6]);
    // Less room than its teams need: as much as it has, the earlier group first.
    s = hostShares([{ id: "c", hostId: "City", slots: 3, divisions: null }], [], new Map(), [group("rec", "d1", 2, { City: 4 }), group("comp", "d1", 4, { City: 8 })]);
    expect([s.get("rec")!.get("City"), s.get("comp")!.get("City")]).toEqual([2, 1]);
    // Half each, even when T already has 4 home games that day.
    const free = [{ id: "c", hostId: "City", slots: 9, divisions: null }, { id: "t", hostId: "T", slots: 9, divisions: null }];
    s = hostShares(free, [], new Map([["T", 4]]), [group("d1", "d1", 6, { City: 6, T: 6 })]);
    expect([s.get("d1")!.get("City"), s.get("d1")!.get("T")]).toEqual([3, 3]);
    // With no fair part to decide it (one team each), what's already made counts: City gets the game.
    s = hostShares(free, [], new Map([["T", 4]]), [group("d1", "d1", 1, { City: 1, T: 1 })]);
    expect([s.get("d1")!.get("City"), s.get("d1")!.get("T") ?? 0]).toEqual([1, 0]);
    // Earl's Boys K–1st: City 7 teams (its court K–1st only), ER 5, Thunder 2, RAA 1, EHYA 1: 8 games, each about half.
    const k1 = [
      { id: "c", hostId: "City", slots: 13, divisions: ["d1"] },
      { id: "e", hostId: "ER", slots: 13, divisions: null },
      { id: "t", hostId: "T", slots: 13, divisions: null },
      { id: "r", hostId: "RAA", slots: 13, divisions: null },
      { id: "h", hostId: "EHYA", slots: 26, divisions: null },
    ];
    s = hostShares(k1, [], new Map(), [group("d1", "d1", 8, { City: 7, ER: 5, T: 2, RAA: 1, EHYA: 1 })]);
    const d1 = s.get("d1")!;
    expect([...d1.values()].reduce((a, b) => a + b, 0)).toBe(8);
    expect(d1.get("City")).toBeGreaterThanOrEqual(3);
    expect(d1.get("City")).toBeLessThanOrEqual(4);
    expect(d1.get("ER")).toBeGreaterThanOrEqual(2);
    expect(d1.get("ER")).toBeLessThanOrEqual(3);
    expect(d1.get("T")).toBe(1);
    // Never more than its teams' games; nothing to share is nothing.
    s = hostShares(free, [], new Map(), [group("d1", "d1", 6, { City: 2, T: 10 })]);
    expect([s.get("d1")!.get("City"), s.get("d1")!.get("T")]).toEqual([1, 5]); // half of each
    expect(hostShares([], [], new Map(), [group("d1", "d1", 6, {})]).get("d1")!.size).toBe(0);
  });
  it("REC first, youngest to oldest, then COMP", () => {
    const g = (level: string, grade: number, index: number) => ({ level, grade, index });
    expect(planOrder([g("COMP", 2, 0), g("REC", 8, 1), g("REC", 2, 3), g("REC", 2, 2)]).map((x) => `${x.level}${x.grade}.${x.index}`)).toEqual(["REC2.2", "REC2.3", "REC8.1", "COMP2.0"]);
  });
});

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

  it("its own grade first: every team of its grade twice this season before another grade; then the same organization last", () => {
    // Two 3rd graders (both X) and two 6th graders: each plays its own grade, even the same organization.
    const teams = [t("1", 1, "X", 3), t("2", 1, "X", 3), t("3", 1, "Y", 6), t("4", 1, "Z", 6)];
    expect(pairs(planMatchups(teams, new Map()))).toEqual([k("1", "2"), k("3", "4")].sort());
    // In its grade, another organization comes before its own.
    const four = [t("1", 1, "X", 3), t("2", 1, "X", 3), t("5", 1, "Y", 3), t("6", 1, "Z", 3)];
    expect(pairs(planMatchups(four, new Map()))).not.toContain(k("1", "2"));
    // Met once: a second meeting in its grade still comes before another grade.
    expect(pairs(planMatchups(teams, new Map([[k("1", "2"), 1], [k("3", "4"), 1]])))).toEqual([k("1", "2"), k("3", "4")].sort());
    // Met twice (every team of its grade): now another grade, not a third meeting.
    expect(pairs(planMatchups(teams, new Map([[k("1", "2"), 2], [k("3", "4"), 2]])))).not.toContain(k("1", "2"));
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

  it("a team with two games that day: home in both or away in both, even over alternating and hosting", () => {
    const h = (club: string, last: HomeTeam["last"] = null, host = 0): HomeTeam => ({ club, last, homeGames: 0, host });
    // Lions (L) play M and R. M was home last time and R away, so alternating alone would split L; L stays one side.
    const teams = new Map([
      ["L", h("Lions", null, 2)],
      ["M", h("Magic", "H", 2)],
      ["R", h("Reinert", "A", 2)],
      ["N", h("North", null, 2)],
      ["T", h("Thunder", null, 2)],
    ]);
    const games = [
      { a: "L", b: "M" },
      { a: "T", b: "N" },
      { a: "R", b: "L" },
    ];
    const sides = assignHome(games, teams);
    const lionsHome = [sides[0] === "a", sides[2] === "b"];
    expect(lionsHome[0]).toBe(lionsHome[1]);
    // A list where L is split costs more than any other.
    expect(homeCost(games, ["a", "a", "a"], teams, new Map(), new Map(), null).all).toBeGreaterThan(homeCost(games, ["a", "a", "b"], teams, new Map(), new Map(), null).all);
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

  it("hosting: home is the team whose organization hosts; every game gets a host where it can; hosts share the home games", () => {
    const h = (club: string, host: number, last: HomeTeam["last"] = null): HomeTeam => ({ club, last, homeGames: 0, host });
    const teams = new Map([
      ["1", h("City", 2)],
      ["2", h("Solo", 0)],
      ["3", h("Away", 1)], // hosts, but no gym open that day
      ["4", h("ER", 2)],
      ["5", h("City", 2, "H")],
    ]);
    expect(assignHome([{ a: "2", b: "1" }], teams)).toEqual(["b"]);
    expect(assignHome([{ a: "2", b: "5" }], teams)).toEqual(["b"]); // even home last time
    expect(assignHome([{ a: "3", b: "4" }], teams)).toEqual(["b"]); // the one with a gym open
    expect(assignHome([{ a: "2", b: "3" }], teams)).toEqual(["b"]);
    expect(assignHome([{ a: "1", b: null }, { a: "2", b: null }], teams)[0]).toBe("a"); // against TBD, the host is home
    // Two hosts: the one two home games ahead in the division is away, even if it was away last time.
    const two = new Map([["1", h("City", 2, "A")], ["4", h("ER", 2, "H")]]);
    expect(assignHome([{ a: "1", b: "4" }], two)).toEqual(["a"]);
    expect(assignHome([{ a: "1", b: "4" }], two, new Map([["City", { home: 2, total: 4 }]]))).toEqual(["b"]);
    // No room left at City: it's away to another host, and has no gym like one whose gyms are closed.
    expect(assignHome([{ a: "1", b: "4" }], two, new Map([["ER", { home: 9, total: 9 }]]), new Map(), new Map([["City", 0], ["ER", 5]]))).toEqual(["b"]);

    // Four host teams and four that can't host: each game has a host, never two that can't.
    const list = ["1", "2", "3", "4", "5", "6", "7", "8"].map((id) => ({ ...t(id, 1, `C${id}`), host: Number(id) <= 4 ? 2 : 0 }));
    for (const [a, b] of planMatchups(list, new Map()).pairs) expect([a, b].filter((x) => Number(x) <= 4)).toHaveLength(1);
    // Like the League: City has 6 teams, ER 3, Thunder 3: home games 2 each, not 4 for City; with room for only 1, ER has 1.
    const clubs = ["City", "City", "City", "City", "City", "City", "ER", "ER", "ER", "Thunder", "Thunder", "Thunder"];
    const league = clubs.map((c, i) => ({ ...t(String(i + 1), 1, c), host: 2 }));
    const home = new Map(league.map((x) => [x.id, { club: x.club, last: null, homeGames: 0, host: 2 } as HomeTeam]));
    const count = (ps: [string, string][]) => {
      const games = ps.map(([a, b]) => ({ a, b }));
      const n: Record<string, number> = {};
      assignHome(games, home).forEach((s, i) => {
        const c = home.get(s === "a" ? games[i].a : games[i].b)!.club;
        n[c] = (n[c] ?? 0) + 1;
      });
      return n;
    };
    const p = planMatchups(league, new Map(), 300, new Map(), (ps) => Object.values(count(ps)).reduce((s, v) => s + v * v, 0) * 8);
    expect(count(p.pairs)).toEqual({ City: 2, ER: 2, Thunder: 2 });
    const room = new Map([["City", 9], ["ER", 1], ["Thunder", 9]]);
    const list2 = p.pairs.map(([a, b]) => ({ a, b }));
    const sides = assignHome(list2, home, new Map(), new Map(), room);
    const er = list2.filter((g, i) => home.get(sides[i] === "a" ? g.a : g.b)!.club === "ER");
    expect(er.length).toBeLessThanOrEqual(1);
    // Over the whole day: Thunder already has 4 home games in other divisions, so here it has fewer.
    const day = assignHome(list2, home, new Map([["Thunder", { home: 4, total: 8 }]]));
    expect(list2.filter((g, i) => home.get(day[i] === "a" ? g.a : g.b)!.club === "Thunder").length).toBeLessThanOrEqual(1);
  });
});
