import { describe, expect, it } from "vitest";
import { addWeeks, localParts, parseSheetTime, weekOf, zonedTime, timeLabel, dayLabel, easternDate } from "./time";

describe("Eastern time helpers", () => {
  it("reads sheet times as Eastern, before and after daylight saving ends", () => {
    expect(parseSheetTime("10/26/2026 6:00 PM")?.toISOString()).toBe("2026-10-26T22:00:00.000Z"); // EDT
    expect(parseSheetTime("11/9/2026 6:00 PM")?.toISOString()).toBe("2026-11-09T23:00:00.000Z"); // EST
    expect(parseSheetTime("1/5/2027 8:00 AM")?.toISOString()).toBe("2027-01-05T13:00:00.000Z");
    expect(parseSheetTime("12/1/2026 12:00 PM")?.toISOString()).toBe("2026-12-01T17:00:00.000Z");
    expect(parseSheetTime("nope")).toBeNull();
  });

  it("weeks run Monday to Monday, Eastern", () => {
    const thu = zonedTime(2026, 11, 12, 18);
    const w = weekOf(thu);
    expect(w.start.toISOString()).toBe(zonedTime(2026, 11, 9).toISOString());
    expect(w.end.toISOString()).toBe(zonedTime(2026, 11, 16).toISOString());
    // Monday 12:00 AM starts a new week; Sunday 11:59 PM is still the old one.
    expect(weekOf(zonedTime(2026, 11, 16, 0)).start.toISOString()).toBe(zonedTime(2026, 11, 16).toISOString());
    expect(weekOf(zonedTime(2026, 11, 15, 23, 59)).start.toISOString()).toBe(zonedTime(2026, 11, 9).toISOString());
  });

  it("adding weeks keeps the wall-clock time across a daylight-saving change", () => {
    const before = zonedTime(2026, 10, 26, 18); // EDT
    const after = addWeeks(before, 2); // Nov 9, EST
    expect(localParts(after)).toMatchObject({ month: 11, day: 9, hour: 18, minute: 0, weekday: 1 });
  });
});

describe("timeLabel", () => {
  it("shows a 24-hour time as AM/PM", () => {
    expect(["00:00", "09:00", "12:00", "13:05", "21:00", "23:45"].map(timeLabel)).toEqual([
      "12:00 AM",
      "9:00 AM",
      "12:00 PM",
      "1:05 PM",
      "9:00 PM",
      "11:45 PM",
    ]);
  });
});

describe("dates", () => {
  it("easternDate is the Eastern calendar day; dayLabel shows a date without shifting it", () => {
    expect(easternDate(new Date("2026-11-03T03:30:00Z"))).toBe("2026-11-02"); // 10:30 PM Eastern
    expect(easternDate(new Date("2026-11-03T05:30:00Z"))).toBe("2026-11-03");
    expect(dayLabel("2027-01-09")).toBe("Jan 9, 2027");
  });
});
