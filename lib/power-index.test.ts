import { describe, expect, it } from "vitest";
import { computePi, type PiGame, type PiTeam } from "./power-index";

const team = (id: string, grade: number, level = "REC"): PiTeam => ({ id, grade, level });
const win = (a: PiTeam, b: PiTeam, scoreA = 30, scoreB = 20, bracket = false): PiGame => ({ a, b, scoreA, scoreB, forfeit: null, bracket });
const pi = (teams: PiTeam[], games: PiGame[]) => computePi(teams.map((t) => t.id), games);

describe("the Power Index", () => {
  it("everyone starts at 500; the grade itself never matters: 3rd vs 3rd moves exactly as 8th vs 8th", () => {
    const [a3, b3, a8, b8] = [team("a3", 3), team("b3", 3), team("a8", 8), team("b8", 8)];
    const r = pi([a3, b3, a8, b8], [win(a3, b3), win(a8, b8)]);
    expect(r.get("a3")).toEqual(r.get("a8"));
    expect(r.get("b3")).toEqual(r.get("b8"));
    expect(r.get("a3")!.pi).toBeGreaterThan(500);
    expect(r.get("a3")).toMatchObject({ wins: 1, losses: 0, games: 1 });
    expect(pi([a3, b3], []).get("a3")).toEqual({ pi: 500, wins: 0, losses: 0, games: 0 });
  });

  it("playing up, and REC beating COMP, gain more; losing down, and COMP losing to REC, cost more", () => {
    const same = pi([team("x", 4), team("y", 4)], [win(team("x", 4), team("y", 4))]).get("x")!.pi;
    const up = pi([team("x", 4), team("y", 5)], [win(team("x", 4), team("y", 5))]).get("x")!.pi; // a 4th beats a 5th
    const recBeatsComp = pi([team("x", 4), team("y", 4, "COMP")], [win(team("x", 4), team("y", 4, "COMP"))]);
    expect(up).toBeGreaterThan(same);
    expect(recBeatsComp.get("x")!.pi).toBeGreaterThan(up); // +100 for the level beats +50 for one grade
    const lostSame = pi([team("x", 5), team("y", 5)], [win(team("y", 5), team("x", 5))]).get("x")!.pi;
    const lostDown = pi([team("x", 5), team("y", 4)], [win(team("y", 4), team("x", 5))]).get("x")!.pi; // a 5th loses to a 4th
    expect(lostDown).toBeLessThan(lostSame);
    expect(recBeatsComp.get("y")!.pi).toBeLessThan(lostSame); // COMP losing to REC costs the most
  });

  it("margin counts up to the cap; a forfeit is a plain win; few games stay near 500; Brackets games weigh more", () => {
    const [a, b] = [team("a", 5), team("b", 5)];
    const by = (sa: number, sb: number) => pi([a, b], [win(a, b, sa, sb)]).get("a")!.pi;
    expect(by(31, 30)).toBeLessThan(by(40, 30));
    expect(by(60, 30)).toBe(by(45, 30)); // past 15 points, no more credit
    const ff = pi([a, b], [{ a, b, scoreA: null, scoreB: null, forfeit: "b", bracket: false }]).get("a")!;
    expect(ff).toMatchObject({ wins: 1, games: 1 });
    expect(ff.pi).toBeGreaterThan(500);
    expect(ff.pi).toBeLessThanOrEqual(by(31, 30)); // no margin credit
    expect(by(40, 30)).toBeLessThan(560); // one game: pulled toward 500
    expect(pi([a, b], [win(a, b, 40, 30, true)]).get("a")!.pi).toBeGreaterThan(by(40, 30));
    // Unscored games don't count.
    expect(pi([a, b], [{ a, b, scoreA: null, scoreB: null, forfeit: null, bracket: false }]).get("a")!.games).toBe(0);
  });
});
