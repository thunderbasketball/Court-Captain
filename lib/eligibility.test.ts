import { describe, expect, it } from "vitest";
import { eligibility, eligibilityChip, rosterIssue, schoolYearOf } from "./eligibility";

describe("grade eligibility (3rd grade, 2026-27, control date Aug 1, 2027)", () => {
  const y = schoolYearOf("2026-11-10");
  it("school year turns over Aug 1", () => {
    expect(y).toBe(2026);
    expect(schoolYearOf("2027-07-31")).toBe(2026);
    expect(schoolYearOf("2027-08-01")).toBe(2027);
  });
  it("3rd grader or below who doesn't turn 11 before Aug 1, 2027", () => {
    expect(eligibility(["3"], "3", "2017-03-04", y)).toBe("ok");
    expect(eligibility(["3"], "2", "2016-08-01", y)).toBe("ok"); // turns 11 on Aug 1: not before
    expect(eligibility(["3"], "3", "2016-07-31", y)).toBe("too-old"); // turns 11 Jul 31, 2027
  });
  it("a 4th grader can't, unless they don't turn 10 before Aug 1, 2027 (age exception)", () => {
    expect(eligibility(["3"], "4", "2017-07-31", y)).toBe("grade");
    expect(eligibility(["3"], "4", "2017-08-01", y)).toBe("exception");
    expect(eligibilityChip("exception", "4", ["3"])?.text).toBe("Age exception");
    expect(eligibilityChip("exception", "3", ["3"])).toBeNull(); // young 3rd grader: nothing to show
  });
  it("two-grade teams use the top grade; other grades follow the same pattern", () => {
    expect(eligibility(["2", "3"], "3", "2017-03-04", y)).toBe("ok");
    expect(eligibility(["1"], "1", "2018-08-01", y)).toBe("ok"); // 1st: not 9 before Aug 1, 2027
    expect(eligibility(["1"], "1", "2018-07-31", y)).toBe("too-old");
    expect(eligibility(["K"], "K", "2019-08-01", y)).toBe("ok"); // K: not 8 before Aug 1, 2027
  });
  it("a roster's problems for its card title", () => {
    const r = (grade: string, birthdate: string | null) => ({ grade, birthdate });
    expect(rosterIssue(["3"], [r("3", "2017-03-04"), r("3", null)], y)).toBeNull();
    expect(rosterIssue(["3"], [r("3", "2015-01-01"), r("3", "2017-03-04")], y)).toBe("1 Too old");
    expect(rosterIssue(["3"], [r("3", "2015-01-01"), r("4", "2017-01-01")], y)).toBe("2 not eligible");
  });
  it("set in the gear: another control date, oldest age, or no age exception", () => {
    const sep1 = { month: 9, day: 1, oldest: 8, exception: 7 };
    expect(eligibility(["3"], "3", "2016-08-15", y)).toBe("ok");
    expect(eligibility(["3"], "3", "2016-08-15", y, sep1)).toBe("too-old"); // turns 11 Aug 15, 2027: before Sep 1
    const none = { month: 8, day: 1, oldest: 8, exception: null };
    expect(eligibility(["3"], "4", "2017-08-01", y, none)).toBe("grade");
    expect(eligibility(["3"], "3", "2016-07-31", y, { ...none, oldest: 9 })).toBe("ok"); // 3rd: not 12
  });
  it("no birthdate on file", () => {
    expect(eligibility(["3"], "3", null, y)).toBe("no-birthdate");
  });
});
