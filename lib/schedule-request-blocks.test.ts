import { describe, expect, it } from "vitest";
import { blockedBy, closesOn } from "./schedule-request-blocks";

describe("schedule request blocks", () => {
  it("closes: REC 2 weeks before the League's first Game Day, COMP the Sunday before the day", () => {
    expect(closesOn("REC", "2027-01-16", "2027-01-09")).toBe("2026-12-26");
    expect(closesOn("COMP", "2027-01-16", "2027-01-09")).toBe("2027-01-10"); // Sat Jan 16 → Sun Jan 10
    expect(closesOn("COMP", "2027-01-17", "2027-01-09")).toBe("2027-01-10"); // a Sunday Game Day → the Sunday before
  });
  it("a game is blocked by any block it overlaps", () => {
    expect(blockedBy(["12"], 11 * 60, 55)).toEqual([]);
    expect(blockedBy(["12"], 11 * 60 + 30, 55)).toEqual(["12–3 PM"]);
    expect(blockedBy(["09", "18"], 15 * 60, 55)).toEqual([]);
    expect(blockedBy(["09", "18"], 17 * 60 + 30, 55)).toEqual(["6–9 PM"]);
  });
});
