import { describe, expect, it } from "vitest";
import { rankGames, type GotwTeam } from "./games-of-week";

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
});
