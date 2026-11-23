import { describe, expect, it } from "vitest";
import { blockLabel, blockedBy, closesOn, parseSettings } from "./schedule-request-blocks";

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
  it("a League's own blocks: 2 to 8, sorted, no overlaps; a limit below the number of blocks", () => {
    expect(blockLabel(9 * 60, 12 * 60)).toBe("9 AM–12 PM");
    expect(blockLabel(12 * 60, 15 * 60)).toBe("12–3 PM");
    expect(blockLabel(8 * 60 + 30, 11 * 60)).toBe("8:30–11 AM");
    const ok = parseSettings({ blocks: [{ start: "13:00", end: "17:00" }, { start: "08:30", end: "13:00" }], max: 1 });
    expect(ok).toEqual({
      ok: true,
      max: 1,
      blocks: [
        { key: "0830", label: "8:30 AM–1 PM", start: 510, end: 780 },
        { key: "13", label: "1–5 PM", start: 780, end: 1020 },
      ],
    });
    expect(parseSettings({ blocks: [{ start: "09:00", end: "12:00" }], max: 1 })).toMatchObject({ ok: false });
    expect(parseSettings({ blocks: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "14:00" }], max: 1 })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/overlap/),
    });
    expect(parseSettings({ blocks: [{ start: "12:00", end: "09:00" }, { start: "13:00", end: "14:00" }], max: 1 })).toMatchObject({ ok: false });
    expect(parseSettings({ blocks: [{ start: "09:00", end: "12:00" }, { start: "12:00", end: "15:00" }], max: 2 })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/free for at least one/),
    });
    expect(parseSettings({ blocks: [{ start: "9am", end: "12:00" }, { start: "12:00", end: "15:00" }], max: 1 })).toMatchObject({ ok: false });
  });
});
