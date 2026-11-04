import { describe, expect, it } from "vitest";
import { baseName, existingTeams, namePlanner, placeName, settleName } from "./team-names";

const t = (id: string, name: string) => ({ id, name });

describe("team names: the same name is numbered, every one of them", () => {
  it("a free name is used as is; a taken one numbers both teams", () => {
    expect(placeName([t("1", "4B Lee")], "3G Campbell")).toEqual({ name: "3G Campbell", renames: [] });
    expect(placeName([t("1", "3G Campbell")], "3G Campbell")).toEqual({
      name: "3G Campbell 2",
      renames: [{ id: "1", name: "3G Campbell 1" }],
    });
    // A 3rd takes the next number; a gap is filled first.
    expect(placeName([t("1", "3G Campbell 1"), t("2", "3G Campbell 2")], "3G Campbell").name).toBe("3G Campbell 3");
    expect(placeName([t("2", "3G Campbell 2")], "3G Campbell").name).toBe("3G Campbell 1");
    // Old style: "4G TBD" and "4G TBD 2" → the plain one is numbered too.
    expect(placeName([t("1", "4G TBD"), t("2", "4G TBD 2")], "4G TBD")).toEqual({
      name: "4G TBD 3",
      renames: [{ id: "1", name: "4G TBD 1" }],
    });
    // Another coach whose name starts the same isn't the same name.
    expect(placeName([t("1", "3G Campbell-Ross")], "3G Campbell").name).toBe("3G Campbell");
  });

  it("the one team left with a name drops its number", () => {
    expect(settleName([t("1", "3G Campbell 1")], "3G Campbell")).toEqual({ id: "1", name: "3G Campbell" });
    expect(settleName([t("1", "3G Campbell 1"), t("2", "3G Campbell 3")], "3G Campbell")).toBeNull();
    expect(settleName([t("1", "3G Campbell")], "3G Campbell")).toBeNull();
    expect(baseName("3G Campbell 2")).toBe("3G Campbell");
  });

  it("import preview: rows numbered against teams already there and each other", () => {
    const plan = namePlanner([t("9", "3G Campbell")]);
    expect(plan.add("a", "4B Johnson")).toEqual([]);
    expect(plan.add("b", "4B Johnson")).toEqual([]);
    expect(plan.add("c", "3G Campbell")).toEqual(["3G Campbell (already a team) becomes 3G Campbell 1"]);
    expect(["a", "b", "c"].map(plan.nameOf)).toEqual(["4B Johnson 1", "4B Johnson 2", "3G Campbell 2"]);
  });

  it("import: a row with a coach already there is matched by name and level, each team once", () => {
    const there = existingTeams([
      { name: "3G Campbell 1", level: "COMP" },
      { name: "3G Campbell 2", level: "REC" },
    ]);
    expect(there("3G Campbell", "COMP")).toBe(true);
    expect(there("3G Campbell", "REC")).toBe(true);
    expect(there("3G Campbell", "REC")).toBe(false);
  });
});
