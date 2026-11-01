import { describe, expect, it } from "vitest";
import { buildFamilies, type RegRow } from "./family-build";

const reg = (o: Partial<RegRow> & Pick<RegRow, "registrantId" | "registrationId" | "first" | "last">): RegRow => ({
  gender: "Boys",
  grade: "4",
  gradeSort: 4,
  birthdate: null,
  team: null,
  uniformSize: null,
  uniformNumber: null,
  parents: [],
  address: null,
  registeredAt: null,
  totalFees: null,
  amountPaid: null,
  amountRemaining: null,
  ...o,
});
const mom = { first: "Cindy", last: "Clemons", cell: "8654669640", email: "cindy@example.com" };
const dad = { first: "Rob", last: "Clemons", cell: "4235550001", email: null };

describe("families from registrations", () => {
  it("joins siblings on one registration and registrations sharing a parent's cell or email", () => {
    const families = buildFamilies(
      [
        reg({
          registrantId: "a",
          registrationId: "R1",
          first: "Huckaby",
          last: "Clemons",
          grade: "1",
          gradeSort: 1,
          parents: [mom, dad],
          registeredAt: "2026-08-01",
        }),
        reg({
          registrantId: "b",
          registrationId: "R1",
          first: "Ava",
          last: "Clemons",
          gender: "Girls",
          grade: "3",
          gradeSort: 3,
          parents: [mom, dad],
        }),
        // Registered separately by dad, with mom's email in a different case: same family.
        reg({
          registrantId: "c",
          registrationId: "R2",
          first: "Cole",
          last: "Clemons",
          grade: "6",
          gradeSort: 6,
          parents: [dad, { first: "Cindy", last: "Clemons", cell: null, email: "CINDY@example.com" }],
          address: "1 Main St, Chattanooga, TN 37402",
          registeredAt: "2026-09-01",
          totalFees: 200,
          amountPaid: 150,
          amountRemaining: 50,
        }),
        reg({
          registrantId: "d",
          registrationId: "R3",
          first: "Jace",
          last: "Black",
          parents: [{ first: "Christi", last: "Black", cell: "4235559999", email: null }],
        }),
      ],
      new Map([["8654669640", "Cindy Clemons"]]),
    );
    expect(families.map((f) => f.name)).toEqual(["Black family", "Clemons family"]);
    const c = families[1];
    expect(c.children.map((k) => `${k.name} ${k.grade}`)).toEqual(["Huckaby Clemons 1", "Ava Clemons 3", "Cole Clemons 6"]);
    expect(c.guardians).toEqual([
      { name: "Rob Clemons", cell: "4235550001", email: null, login: null },
      { name: "Cindy Clemons", cell: "8654669640", email: "CINDY@example.com", login: "Cindy Clemons" },
    ]);
    expect(c.address).toBe("1 Main St, Chattanooga, TN 37402"); // newest registration's address
    expect(c.fees).toEqual({ total: 200, paid: 150, remaining: 50 });
    expect(c.connected).toBe(true);
    expect(families[0]).toMatchObject({ connected: false, fees: null, guardians: [{ name: "Christi Black", login: null }] });
  });

  it("a child registered twice is listed once; a family with no parent given is named for the child", () => {
    const [f] = buildFamilies(
      [
        reg({ registrantId: "a", registrationId: "R1", first: "Tyus", last: "Harper" }),
        reg({ registrantId: "b", registrationId: "R1", first: "Tyus", last: "Harper" }),
      ],
      new Map(),
    );
    expect(f.name).toBe("Harper family");
    expect(f.children).toHaveLength(1);
    expect(f.guardians).toEqual([]);
  });
});
