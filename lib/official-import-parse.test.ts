import { describe, expect, it } from "vitest";
import { cleanOfficialLevel, guessOfficialColumns, officialTableText, parseOfficials } from "./official-import-parse";
import { splitTable } from "./team-import-parse";

const cols = (text: string) => guessOfficialColumns(splitTable(text));

describe("reading officials pasted or from a CSV file", () => {
  it("matches columns by heading, in any order, leaving the ones it doesn't import", () => {
    expect(cols("Email Address,Mobile,Last Name,First Name,Certification,DOB\nx@y.com,4235550101,Jones,Pat,cert,1/1/80")).toEqual({
      header: true,
      columns: ["email", "cell", "last", "first", "level", "skip"],
    });
    expect(cols("Referee,Phone\nPat Jones,4235550101").columns).toEqual(["name", "cell"]);
  });

  it("without headings: the usual order (First, Last, Cell, Email, Level), unless the values say otherwise", () => {
    expect(cols("Pat,Jones,4235550101,pat@x.com,Certified").columns).toEqual(["first", "last", "cell", "email", "level"]);
    expect(cols("pat@x.com\t423-555-0101\tPat\tJones\tStudent").columns).toEqual(["email", "cell", "first", "last", "level"]);
    expect(cols('"Jones, Pat",(423) 555-0101,Recruit\n"Kim, Lee",4235550102,Student').columns).toEqual(["name", "cell", "level"]);
  });

  it("cleans up names, cells, emails and levels, noting each change", () => {
    const { rows } = parseOfficials(
      "Name\tCell\tEmail\tLevel\nJONES, PAT\t(423) 555-0101\tPat@X.com\tcert\nlee kim\t423.555.0102\t\texp\nAnn Lee\t4235550103\t\tR",
    );
    expect(rows[0]).toMatchObject({ first: "Pat", last: "Jones", cell: "4235550101", email: "pat@x.com", level: "Certified", errors: [] });
    expect(rows[0].fixes).toEqual(['Name "JONES, PAT" → Pat Jones', 'Email "Pat@X.com" → pat@x.com', 'Level "cert" → Certified']);
    expect(rows[1]).toMatchObject({ first: "Lee", last: "Kim", email: null, level: "Experienced", errors: [] });
    expect(rows[2]).toMatchObject({ level: "Recruit", errors: [] }); // one letter in the Level column
  });

  it("says what to fix: names, cells, emails, levels (email and level may be blank)", () => {
    const { rows } = parseOfficials("First,Last,Cell,Email,Level\nPat,,123,bad,Varsity\n=cmd(),Jones,4235550101,,\nLee,Kim,4235550102,,");
    expect(rows[0].errors).toEqual([
      "Name: a first and last name (letters only)",
      'Cell "123": 10 digits',
      'Email "bad" doesn\'t look right (or leave it blank)',
      'Level "Varsity": Certified, Experienced, Student or Recruit (or leave it blank)',
    ]);
    expect(rows[1].errors).toEqual(["Name: a first and last name (letters only)"]);
    expect(rows[2]).toMatchObject({ errors: [], email: null, level: null });
  });

  it("levels any common way; sends rows back under our own headings", () => {
    expect(["Certified", "CERT", "experienced", "Student Official", "rookie", "Varsity"].map((v) => cleanOfficialLevel(v))).toEqual([
      "Certified",
      "Certified",
      "Experienced",
      "Student",
      "Recruit",
      null,
    ]);
    expect(cleanOfficialLevel("S")).toBeNull(); // one letter only in the Level column
    expect(officialTableText([["x", "Pat", "Jones, Jr", "4235550101"]], ["skip", "first", "last", "cell"])).toBe(
      'First Name\tLast Name\tCell\nPat\t"Jones, Jr"\t4235550101',
    );
    expect(parseOfficials(officialTableText([["Pat", "Jones", "4235550101", "", "s"]], ["first", "last", "cell", "email", "level"])).rows[0]).toMatchObject(
      { first: "Pat", level: "Student", errors: [] },
    );
  });
});
