import { describe, expect, it } from "vitest";
import { coachGroups, sharedCoaches } from "./coach-groups";

const t = (teamId: string, ...keys: string[]) => ({ teamId, coaches: keys.map((k) => ({ key: k, name: k.toUpperCase() })) });

describe("coach groups", () => {
  it("links teams sharing any coach, Head or Assistant, through a chain too", () => {
    const teams = [t("A", "sam"), t("B", "ann", "sam"), t("C", "ann"), t("D", "bo"), t("E")];
    expect(coachGroups(teams).map((g) => g.map((x) => x.teamId))).toEqual([["A", "B", "C"]]); // D and E stand alone
    expect(sharedCoaches(coachGroups(teams)[0])).toEqual([
      { key: "ann", name: "ANN", teams: ["B", "C"] },
      { key: "sam", name: "SAM", teams: ["A", "B"] },
    ]);
  });
});
