import { describe, expect, it } from "vitest";
import { matchPlayers, oddBirthdate, oneOff, rulesBroken } from "./roster-match";

const p = (first: string, last: string, dob: string | null = "2016-05-03") => ({ first, last, dob });
const m = (a: ReturnType<typeof p>, b: ReturnType<typeof p>) => matchPlayers(a, b)?.strength ?? null;

describe("the same player on two rosters", () => {
  it("Conflict: the same name and birthdate (capitals, accents, Jr and spaces don't matter)", () => {
    expect(m(p("Ava", "Smith"), p("AVA ", "smith"))).toBe("Conflict");
    expect(m(p("José", "O'Neal Jr."), p("Jose", "ONeal"))).toBe("Conflict");
  });

  it("Likely: the year is wrong, month and day swapped, one digit off; a nickname, one letter off or the names swapped", () => {
    expect(matchPlayers(p("Ava", "Smith"), p("Ava", "Smith", "2026-05-03"))).toEqual({
      strength: "Likely",
      why: "Same name, month and day; the year is different",
    });
    expect(m(p("Ava", "Smith", "2016-05-03"), p("Ava", "Smith", "2016-03-05"))).toBe("Likely");
    expect(m(p("Ava", "Smith", "2016-05-03"), p("Ava", "Smith", "2016-05-08"))).toBe("Likely");
    expect(m(p("William", "Lee"), p("Will", "Lee"))).toBe("Likely");
    expect(m(p("Jayden", "Lee"), p("Jaden", "Lee"))).toBe("Likely");
    expect(m(p("Lee", "Jordan"), p("Jordan", "Lee"))).toBe("Likely");
  });

  it("Check: the same birthdate and one of the names, or the same name with a birthdate missing", () => {
    expect(m(p("Ava", "Smith"), p("Ava", "Jones"))).toBe("Check");
    expect(matchPlayers(p("Ava", "Smith"), p("Mia", "Smith"))).toEqual({ strength: "Check", why: "Same birthdate and last name (possible twins)" });
    expect(m(p("Ava", "Smith", null), p("Ava", "Smith"))).toBe("Check");
  });

  it("two players: the same name and different birthdates, a nickname without the birthdate, or just a birthdate", () => {
    expect(m(p("Ava", "Smith", "2016-05-03"), p("Ava", "Smith", "2014-11-20"))).toBeNull();
    expect(m(p("William", "Lee"), p("Will", "Lee", "2015-05-03"))).toBeNull();
    expect(m(p("Ava", "Smith"), p("Mia", "Jones"))).toBeNull();
    expect(m(p("", "Smith"), p("", "Smith"))).toBeNull();
    expect([oneOff("jaden", "jayden"), oneOff("brian", "brain"), oneOff("mia", "mya"), oneOff("jaden", "jordan")]).toEqual([true, true, false, false]);
  });

  it("two teams are allowed only in the same organization, different divisions, the same level", () => {
    const t = (teamId: string, orgKey: string, divisionId: string, level: string) => ({ teamId, orgKey, divisionId, level });
    expect(rulesBroken(t("1", "a", "d1", "REC"), t("2", "a", "d2", "REC"))).toEqual([]);
    expect(rulesBroken(t("1", "a", "d1", "COMP"), t("2", "a", "d2", "COMP"))).toEqual([]);
    expect(rulesBroken(t("1", "a", "d1", "REC"), t("2", "a", "d2", "COMP"))).toEqual(["REC and COMP"]);
    expect(rulesBroken(t("1", "a", "d1", "REC"), t("2", "b", "d2", "REC"))).toEqual(["Different organizations"]);
    expect(rulesBroken(t("1", "a", "d1", "REC"), t("2", "a", "d1", "REC"))).toEqual(["Same division"]);
    expect(rulesBroken(t("1", "a", "d1", "REC"), t("2", "b", "d1", "COMP"))).toEqual(["REC and COMP", "Different organizations", "Same division"]);
    expect(rulesBroken(t("1", "a", "d1", "REC"), t("1", "a", "d1", "REC"))).toEqual(["Listed twice on the same team"]);
  });

  it("birthdates that can't be right for the grade", () => {
    expect(oddBirthdate("2026-05-03", 4, 2026)).toBe("Born 2026");
    expect(oddBirthdate("2010-05-03", 3, 2026)).toBe("Born 2010, grade 3");
    expect(oddBirthdate("2016-05-03", 4, 2026)).toBeNull();
    expect(oddBirthdate("2022-05-03", -1, 2026)).toBeNull(); // Pre-K
    expect(oddBirthdate(null, 4, 2026)).toBeNull();
  });
});
