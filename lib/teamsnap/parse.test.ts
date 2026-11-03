import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCsv } from "../csv";
import { parseBirthdate, parseProgram, parseRegistrations, schoolYearOf } from "./parse";
import { importRegistrations } from "./import";
import { createTestDb } from "../testing/db";
import { HEADER, row } from "./fixtures";

const parse = (...rows: string[]) => parseRegistrations([HEADER, ...rows].join("\n"), { schoolYear: 2026 });

describe("parseCsv", () => {
  it("handles quotes, commas, doubled quotes and line breaks in fields", () => {
    expect(parseCsv('a,b\n"7719 , Night Hawk Rd","say ""hi""\nthere"\r\n\n')).toEqual([
      ["a", "b"],
      ["7719 , Night Hawk Rd", 'say "hi"\nthere'],
    ]);
  });
});

describe("parseBirthdate", () => {
  it("moves TeamSnap's evening-before times to the real date", () => {
    expect(parseBirthdate("08-03-2020 8:00:00 PM")).toBe("2020-08-04"); // summer (EDT)
    expect(parseBirthdate("12-10-2017 7:00:00 PM")).toBe("2017-12-11"); // winter (EST)
    expect(parseBirthdate("12-31-2017 7:00:00 PM")).toBe("2018-01-01"); // year rollover
    expect(parseBirthdate("02-28-2020 7:00:00 PM")).toBe("2020-02-29"); // leap day
  });

  it("reads single-digit months/days and other formats as-is", () => {
    expect(parseBirthdate("6-9-2016 8:00:00 PM")).toBe("2016-06-10");
    expect(parseBirthdate("6/9/2016")).toBe("2016-06-09");
    expect(parseBirthdate("2016-06-09")).toBe("2016-06-09");
    expect(parseBirthdate("06-09-2016 12:00:00 AM")).toBe("2016-06-09");
  });

  it("rejects nonsense", () => {
    expect(parseBirthdate("")).toBeNull();
    expect(parseBirthdate("13-40-2016")).toBe("invalid");
    expect(parseBirthdate("soon")).toBe("invalid");
  });
});

describe("parseProgram", () => {
  it("reads grade and gender", () => {
    expect(parseProgram("4th Girls")).toEqual({ grade: "4", grade_sort: 4, gender: "Girls" });
    expect(parseProgram("KinderGarten Boys")).toEqual({ grade: "K", grade_sort: 0, gender: "Boys" });
    expect(parseProgram("1st Boys")).toEqual({ grade: "1", grade_sort: 1, gender: "Boys" });
    expect(parseProgram("Uniform Fee")).toBeNull();
  });
});

describe("parseRegistrations", () => {
  it("builds a player with every column kept in raw", () => {
    const r = parse(row({ note1: "Fee changed, by Earl" }));
    expect(r.errors).toEqual([]);
    expect(r.players).toHaveLength(1);
    expect(r.players[0]).toMatchObject({
      registrant_id: "200",
      first_name: "Sam",
      birthdate: "2020-08-04",
      gender: "Boys",
      grade: "1",
      parent1_email: "pat@example.com",
      address: "1 Main St",
      notes: ["Fee changed, by Earl"],
      registered_at: "2026-10-02T13:38:58.000Z",
    });
    expect(r.players[0].raw["Registration Note"]).toBe("Fee changed, by Earl");
    expect(r.players[0].raw).toHaveProperty("Registration Note (2)", "");
  });

  it("keeps siblings with the same registration Id apart", () => {
    const r = parse(row({ rid: "1", first: "Gus" }), row({ rid: "2", first: "Wes" }));
    expect(r.players.map((p) => p.first_name)).toEqual(["Gus", "Wes"]);
  });

  it("skips No Roster and blank-program rows", () => {
    const r = parse(row({ status: "No Roster", rid: "1" }), row({ program: "", rid: "2" }), row({ rid: "3" }));
    expect(r.players).toHaveLength(1);
    expect(r.skipped.map((s) => s.message)).toEqual(["No Roster", "No program/grade"]);
  });

  it("warns about odd data but still imports it", () => {
    const r = parse(
      row({ rid: "1", birthdate: "08-06-1997 8:00:00 PM" }),
      row({ rid: "2", cell: "423762832" }),
      row({ rid: "3", email: "casey@gmail.con" }),
      row({ rid: "4", gender: "Female" }),
    );
    expect(r.errors).toEqual([]);
    expect(r.players).toHaveLength(4);
    expect(r.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining("unusual for 1st Boys"),
      expect.stringContaining("isn't a 10-digit number"),
      expect.stringContaining("looks like a typo"),
      expect.stringContaining("doesn't match program"),
    ]);
  });

  it("a charged Uniform Fee counts as ordering a uniform, even when they answered NO", () => {
    const csv = [
      "Registrant Id,First,Last,Birthdate,Winter Fees,Uniform Needed?,NEW Uniform Fee",
      "1,Ann,A,06-09-2016,4th Girls,YES,Uniform Fee",
      "2,Bo,B,06-09-2016,4th Boys,NO,Uniform Fee",
      "3,Cy,C,06-09-2016,4th Boys,NO,",
    ].join("\n");
    const r = parseRegistrations(csv, { schoolYear: 2026 });
    expect(r.players.map((p) => [p.first_name, p.uniform_needed])).toEqual([
      ["Ann", true],
      ["Bo", true],
      ["Cy", false],
    ]);
  });

  it("fixes all-lowercase names only", () => {
    const r = parse(row({ rid: "1", first: "ethan", last: "McNabb" }));
    expect(r.players[0]).toMatchObject({ first_name: "Ethan", last_name: "McNabb" });
  });

  it("errors on duplicate ids, bad birthdates and unreadable grades", () => {
    const r = parse(row({ rid: "1" }), row({ rid: "1" }), row({ rid: "2", birthdate: "13-45-2016" }), row({ rid: "3", program: "Varsity Boys" }));
    expect(r.errors.map((e) => e.message)).toEqual([
      "Registrant Id 1 appears twice.",
      expect.stringContaining("Can't read birthdate"),
      expect.stringContaining("Can't read grade"),
    ]);
  });

  it("matches headers loosely and finds a renamed season column by its contents", () => {
    const text = ["Registrant ID,First Name,Last Name,Date of Birth,Spring 2027 Fees", "9,Al,Bee,2018-01-01,3rd Girls"].join("\n");
    const r = parseRegistrations(text, { schoolYear: 2026 });
    expect(r.errors).toEqual([]);
    expect(r.players[0]).toMatchObject({ registrant_id: "9", grade: "3", gender: "Girls", birthdate: "2018-01-01" });
  });

  it("refuses a file that isn't a registration export", () => {
    const r = parseRegistrations("Name,Phone\nA,1", { schoolYear: 2026 });
    expect(r.errors[0].message).toMatch(/Missing column/);
  });

  it("school year: fall counts as that year, spring as the year before", () => {
    expect(schoolYearOf(new Date(2026, 9, 27))).toBe(2026);
    expect(schoolYearOf(new Date(2027, 2, 1))).toBe(2026);
  });
});

describe("importRegistrations", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  beforeEach(async () => {
    await db.reset();
  });
  const now = new Date("2026-10-27T12:00:00Z");

  it("replaces everything and records who imported", async () => {
    await importRegistrations(db.pool, parse(row({ rid: "1" }), row({ rid: "2" })), "Earl Epps", now);
    await importRegistrations(db.pool, parse(row({ rid: "3", first: "New" })), "Earl Epps", now);
    const r = await db.pool.query("select registrant_id, first_name, imported_by, raw->>'first' as raw_first, notes from registrations");
    expect(r.rows).toEqual([{ registrant_id: "3", first_name: "New", imported_by: "Earl Epps", raw_first: "New", notes: [] }]);
  });

  it("a file with errors changes nothing", async () => {
    await importRegistrations(db.pool, parse(row({ rid: "1" })), "Earl Epps", now);
    const bad = parse(row({ rid: "2" }), row({ rid: "2" }));
    await expect(importRegistrations(db.pool, bad, "Earl Epps", now)).rejects.toThrow(/nothing was changed/);
    const r = await db.pool.query("select registrant_id from registrations");
    expect(r.rows).toEqual([{ registrant_id: "1" }]);
  });
});
