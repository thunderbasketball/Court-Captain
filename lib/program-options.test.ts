import { describe, expect, it } from "vitest";
import { planChoice, type Choice, type ProgramOption } from "./program-options";

const offered: ProgramOption[] = [
  { kind: "all_season", feeCents: 30000 },
  { kind: "single_1", feeCents: 3500 },
  { kind: "single_2nd", feeCents: 2000 },
  { kind: "single_2", feeCents: 6000 },
];
const dates = ["2026-12-05", "2026-12-12", "2026-12-19", "2027-01-09"];
const none: Choice = { allSeason: false, days: [] };

describe("League registration choices", () => {
  it("ALL Season: 1GG every Game Day and the brackets; a 2nd Game makes a day 2GG", () => {
    const r = planChoice(offered, dates, none, { allSeason: true, days: [{ date: "2026-12-12", kind: "single_2nd" }] });
    expect(r).toMatchObject({
      result: { perDate: { "2026-12-05": 1, "2026-12-12": 2, "2026-12-19": 1, "2027-01-09": 1 }, bracket: true, feeCents: 32000 },
      newFeeCents: 32000,
    });
  });

  it("Single Days: 1GG or 2GG per date; the brackets need half the Game Days; fees per date", () => {
    const one = planChoice(offered, dates, none, { allSeason: false, days: [{ date: "2026-12-05", kind: "single_2" }] });
    expect(one).toMatchObject({ result: { perDate: { "2026-12-05": 2 }, bracket: false, feeCents: 6000 } });
    const had = (one as { merged: Choice }).merged;
    // Later: another day, then a 2nd Game on it. Two of four days = half: in the brackets.
    const two = planChoice(offered, dates, had, { allSeason: false, days: [{ date: "2027-01-09", kind: "single_1" }] });
    expect(two).toMatchObject({ result: { perDate: { "2026-12-05": 2, "2027-01-09": 1 }, bracket: true }, newFeeCents: 3500 });
    const three = planChoice(offered, dates, (two as { merged: Choice }).merged, {
      allSeason: false,
      days: [{ date: "2027-01-09", kind: "single_2nd" }],
    });
    expect(three).toMatchObject({ result: { perDate: { "2027-01-09": 2 }, feeCents: 11500 }, newFeeCents: 2000 });
  });

  it("refuses what doesn't fit", () => {
    const err = (had: Choice, add: Choice) => (planChoice(offered, dates, had, add) as { error?: string }).error;
    const day = (date: string, kind: "single_1" | "single_2nd" | "single_2") => ({ allSeason: false, days: [{ date, kind }] });
    expect(err(none, none)).toBe("Pick ALL Season or at least one date.");
    expect(err(none, day("2026-12-06", "single_1"))).toMatch(/isn't one of this League's Game Days/);
    expect(err(none, day("2026-12-05", "single_2nd"))).toMatch(/needs a game that day first/);
    expect(err({ allSeason: true, days: [] }, day("2026-12-05", "single_1"))).toMatch(/ALL Season already plays/);
    expect(err({ allSeason: true, days: [] }, day("2026-12-05", "single_2"))).toMatch(/Pick Add a 2nd Game/);
    expect(err(day("2026-12-05", "single_1"), day("2026-12-05", "single_1"))).toMatch(/Already registered/);
    expect(err({ allSeason: true, days: [] }, { allSeason: true, days: [] })).toBe("Already registered for ALL Season.");
    expect(
      (planChoice([{ kind: "single_1", feeCents: 100 }], dates, none, { allSeason: true, days: [] }) as { error?: string }).error,
    ).toBe("This League doesn't offer ALL Season.");
  });
});
