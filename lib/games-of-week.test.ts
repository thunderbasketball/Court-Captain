import { describe, expect, it } from "vitest";
import { inRecap, rankGames, recapGames, type GotwTeam } from "./games-of-week";

const t = (name: string, w: number, l: number, pi = 500): GotwTeam => ({ id: name, name, w, l, pi });
const game = (home: GotwTeam, away: GotwTeam) => ({ home, away });

describe("Games of the Week", () => {
  it("only games where both teams have played; best combined record first, then the more even, then games played, then combined PI", () => {
    const games = [
      game(t("A", 3, 0), t("B", 0, 3)), // 1.0 combined, uneven
      game(t("C", 2, 1), t("D", 2, 1)), // 1.33, even
      game(t("E", 3, 0), t("F", 3, 0)), // 2.0
      game(t("G", 1, 0), t("H", 0, 0)), // H hasn't played: out
      game(t("I", 4, 2), t("J", 4, 2)), // 1.33, even, more games than C–D
      game(t("K", 2, 1, 560), t("L", 2, 1, 540)), // 1.33, even, same games as C–D, higher PIs
    ];
    expect(rankGames(games).map((g) => g.home.name)).toEqual(["E", "I", "K", "C", "A"]);
    expect(rankGames(games, 2)).toHaveLength(2);
    expect(rankGames([game(t("X", 0, 0), t("Y", 0, 0))])).toEqual([]); // week 1: none qualify
  });

  it("Game Recaps from noon on Game Day until Tuesday; else Upcoming Game Highlights", () => {
    expect(inRecap("2026-12-05", "2026-12-05", 11)).toBe(false); // Saturday morning
    expect(inRecap("2026-12-05", "2026-12-05", 12)).toBe(true); // Saturday noon
    expect(inRecap("2026-12-05", "2026-12-06", 9)).toBe(true); // Sunday
    expect(inRecap("2026-12-05", "2026-12-07", 23)).toBe(true); // Monday night
    expect(inRecap("2026-12-05", "2026-12-08", 0)).toBe(false); // Tuesday
    expect(inRecap(null, "2026-12-06", 9)).toBe(false);
  });

  it("a recap: the highlighted games (scored) first, then the closest finals", () => {
    const t = (id: string, w: number, l: number): GotwTeam => ({ id, name: id, w, l, pi: 500 });
    const f = (home: number, away: number) => ({ home, away, forfeit: null });
    const games = [
      { id: "blowout", home: t("A", 0, 0), away: t("B", 0, 0), final: f(40, 10) },
      { id: "close", home: t("C", 0, 0), away: t("D", 0, 0), final: f(31, 30) },
      { id: "forfeit", home: t("E", 0, 0), away: t("F", 0, 0), final: { home: null, away: null, forfeit: "home" as const } },
      { id: "top", home: t("G", 2, 0), away: t("H", 2, 0), final: f(20, 25) },
      { id: "unplayed", home: t("I", 3, 0), away: t("J", 3, 0), final: null },
    ];
    expect(recapGames(games, 3).map((g) => g.id)).toEqual(["top", "close", "blowout"]);
  });
});
