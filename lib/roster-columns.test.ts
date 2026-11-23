import { describe, expect, it } from "vitest";
import { checkColumns, guessColumns, rowsToPlayers, splitFullName, splitRows } from "./roster-columns";

describe("importing a roster: which column holds what", () => {
  it("columns lined up with spaces (full name, birthdate, grade, jersey): split and guessed", () => {
    const text = [
      "Jordan Avery II            11/1/2010   4   10",
      "Casey Brooks               10/25/2017  4   0",
      "Zy'ion Carter              2/1/2016    4   7",
      "Riley Dawson    9/1/2017    4   5",
      "Morgan Ellis                  3/20/2017    4   24",
    ].join("\n");
    const rows = splitRows(text);
    expect(rows[0]).toEqual(["Jordan Avery II", "11/1/2010", "4", "10"]);
    expect(rows[3]).toEqual(["Riley Dawson", "9/1/2017", "4", "5"]);
    const g = guessColumns(rows);
    expect(g).toEqual({ columns: ["name", "birthdate", "grade", "jersey"], header: false });
    expect(rowsToPlayers(rows, g.columns, g.header)[0]).toEqual({
      line: 1,
      first: "Jordan",
      last: "Avery II",
      grade: "4",
      jersey: "10",
      birthdate: "11/1/2010",
    });
  });

  it("pasted rows lined up with extra tabs here and there: the empty cells are spacing, so values line up", () => {
    const rows = splitRows("Jordan Avery II\t\t\t11/1/2010\t4\t10\nRiley Dawson\t9/1/2017\t4\t5\nCasey Brooks\t\t10/25/2017\t4\t0");
    expect(rows).toEqual([
      ["Jordan Avery II", "11/1/2010", "4", "10"],
      ["Riley Dawson", "9/1/2017", "4", "5"],
      ["Casey Brooks", "10/25/2017", "4", "0"],
    ]);
    expect(guessColumns(rows).columns).toEqual(["name", "birthdate", "grade", "jersey"]);
    // A spreadsheet's rows are one length: an empty jersey stays in its column.
    expect(splitRows("Ava Smith\t\t4\nLiam Jones\t7\t4")).toEqual([["Ava Smith", "", "4"], ["Liam Jones", "7", "4"]]);
  });

  it("a header row names the columns, in any order; tabs and CSV with quotes", () => {
    const tab = splitRows("Jersey\tLast\tFirst\tDOB\tGrade\n12\tSmith\tAva\t5/3/2016\t4");
    expect(guessColumns(tab)).toEqual({ columns: ["jersey", "last", "first", "birthdate", "grade"], header: true });
    expect(rowsToPlayers(tab, ["jersey", "last", "first", "birthdate", "grade"], true)).toEqual([
      { line: 2, first: "Ava", last: "Smith", grade: "4", jersey: "12", birthdate: "5/3/2016" },
    ]);
    const csv = splitRows('Player,Grade,Birthdate\n"Lee, Mia",5th,2015-09-21');
    expect(guessColumns(csv)).toEqual({ columns: ["name", "grade", "birthdate"], header: true });
    expect(rowsToPlayers(csv, ["name", "grade", "birthdate"], true)[0]).toMatchObject({ first: "Mia", last: "Lee", grade: "5th" });
  });

  it("no header: separate first and last name columns; grades told from jerseys by how few different values", () => {
    const rows = splitRows("Ava,Smith,23,4\nLiam,Jones,7,4\nNoah,Lee,15,5");
    expect(guessColumns(rows).columns).toEqual(["first", "last", "jersey", "grade"]);
  });

  it("full names: suffixes stay with the last name; a column chosen as Skip is left out; unknown kinds are refused", () => {
    expect(splitFullName("Mary Ann Smith")).toEqual({ first: "Mary Ann", last: "Smith" });
    expect(splitFullName("Tre Jones Jr.")).toEqual({ first: "Tre", last: "Jones Jr." });
    expect(rowsToPlayers([["Ava Smith", "x", "4"]], ["name", "skip", "grade"], false)[0]).toMatchObject({ first: "Ava", grade: "4", jersey: "" });
    expect(checkColumns(["name", "grade"])).toEqual(["name", "grade"]);
    expect(checkColumns(["name", "=cmd()"])).toBeNull();
    expect(checkColumns("name")).toBeNull();
  });
});
