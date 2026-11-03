import { describe, expect, it } from "vitest";
import { cleanGender, cleanGrade, cleanLevel, guessColumns, parseTeamRows, splitTable, tableText } from "./team-import-parse";

describe("reading pasted teams", () => {
  it("reads CSV or tab-separated rows, skips a header, and understands common ways of writing grades and gender", () => {
    const csv = `Team,Gender,Grade,Level,Coach First,Coach Last,Coach Cell
Bolts,Boys,3rd/4th,comp,Sam,Lee,(423) 555-0101
"Rockets, Jr",G,K,REC,,,
Comets\tM\t5th Grade\tRec\t\t\t`;
    const { rows, tooMany } = parseTeamRows(csv);
    expect(tooMany).toBe(false);
    expect(rows.map((r) => [r.name, r.gender, r.grade, r.level, r.coach?.cell ?? null, r.errors])).toEqual([
      ["Bolts", "Boys", "3-4", "COMP", "4235550101", []],
      ["Rockets, Jr", "Girls", "0", "REC", null, []],
      ["Comets", "Boys", "5", "REC", null, []],
    ]);
  });

  it("marks each problem on its row, and refuses formulas", () => {
    const { rows } = parseTeamRows("=cmd,Boys,3,REC\nOK,Coed,3/5,AAA,Sam,,555");
    expect(rows[0].errors).toEqual(["Team name: letters, numbers and simple punctuation (up to 60)"]);
    expect(rows[1].errors).toEqual([
      "Gender: Boys or Girls",
      'Grade "3/5": one grade, or two in a row (like 3rd/4th)',
      'Level "AAA": REC or COMP (R or C is fine)',
      "Coach: first name, last name and a 10-digit cell (or leave all three blank)",
    ]);
    expect(rows[1].line).toBe(2);
  });
});

describe("reading pasted teams named from their Head Coach (no Team column)", () => {
  it("shifts the columns; the coach is optional unless required", () => {
    const { rows } = parseTeamRows(
      "Gender,Grade,Level,Coach First,Coach Last,Coach Cell\nGirls,4th,COMP,Earl,Epps,4235550111\nBoys,3,REC,,,",
      { named: false },
    );
    expect(rows.map((r) => [r.gender, r.grade, r.level, r.coach?.last ?? null, r.errors])).toEqual([
      ["Girls", "4", "COMP", "Epps", []],
      ["Boys", "3", "REC", null, []], // no coach yet: "3B TBD"
    ]);
  });
});

describe("cleaning up pasted teams", () => {
  it("in the Level column, any word starting with R is REC and C is COMP; guessing the column stays strict", () => {
    const { rows } = parseTeamRows("Gender,Grade,Level\nGirls,7,COM\nBoys,3,Recr\nBoys,4,Travel\nBoys,4,Pro", { named: false });
    expect(rows.map((r) => [r.level, r.fixes, r.errors.length])).toEqual([
      ["COMP", ['Level "COM" → COMP'], 0],
      ["REC", ['Level "Recr" → REC'], 0],
      ["COMP", ['Level "Travel" → COMP'], 0],
      [null, [], 1],
    ]);
    expect(cleanLevel("Carter")).toBeNull();
    expect(cleanLevel("Carter", true)).toBe("COMP");
  });

  it("reads short misspellings of Girls and Boys", () => {
    const words = ["Grils", "Gilrs", "Gilr", "Bosy", "Boyz", "Gold", "Black", "Blue", "Coed"];
    expect(words.map(cleanGender)).toEqual(["Girls", "Girls", "Girls", "Boys", "Boys", null, null, null, null]);
    expect(
      parseTeamRows("Gender,Grade,Level,Alternate Team Name\nGrils,3,REC,Thunder 3G", { named: false }).rows[0],
    ).toMatchObject({ gender: "Girls", altName: "Thunder 3G", fixes: ['Gender "Grils" → Girls'] });
  });

  it("reads grades 10, 11 and 12, a letter O typed for zero, hidden characters and spreadsheet numbers", () => {
    expect(["10", "11th", "12th Grade", "1O", "1o", "10\u200b", "１０", "10.0", "11/12"].map((g) => cleanGrade(g).grade)).toEqual(
      ["10", "11", "12", "10", "10", "10", "10", "10", "11-12"],
    );
    const { rows } = parseTeamRows("Gender,Grade,Level\nGirls,1O,COMP", { named: false });
    expect(rows[0]).toMatchObject({ grade: "10", errors: [], fixes: ['Grade "1O" → 10th'] });
  });

  it("fixes common ways of writing things and says what it changed", () => {
    const { rows } = parseTeamRows(
      "Sex\tGrade\tType\tHead Coach\tPhone\tEmail\nb\t3 & 4\tR\tthomas battle\t423.555.0101\tx@y.z\nGIRLS\t5th Grade\tc\tLee, Sam\t4235550102\t",
      { named: false },
    );
    expect(rows.map((r) => [r.gender, r.grade, r.level, r.coach, r.fixes, r.errors])).toEqual([
      [
        "Boys",
        "3-4",
        "REC",
        { first: "Thomas", last: "Battle", cell: "4235550101" },
        ['Gender "b" → Boys', 'Grade "3 & 4" → 3rd/4th', 'Level "R" → REC', 'Coach "thomas battle" → Thomas Battle'],
        [],
      ],
      [
        "Girls",
        "5",
        "COMP",
        { first: "Sam", last: "Lee", cell: "4235550102" },
        ['Gender "GIRLS" → Girls', 'Level "c" → COMP', 'Coach "Lee, Sam" → Sam Lee'],
        [],
      ],
    ]);
  });

  it("matches columns by heading or by what's in them, and fills grade and gender from a team name", () => {
    const named = splitTable("Hixson Hoops,REC,Boys,5th,4235550101");
    expect(guessColumns(named, true).columns).toEqual(["name", "level", "gender", "grade", "coachCell"]);
    expect(guessColumns(splitTable("Gender,Grade,Level\nBoys,3,REC"), false)).toEqual({
      header: true,
      columns: ["gender", "grade", "level"],
    });
    const { rows } = parseTeamRows("Team,Level,Coach,Cell\n3/4G Smith,COMP,Ann Smith,4235550103", { named: false });
    expect(rows[0]).toMatchObject({ gender: "Girls", grade: "3-4", level: "COMP", errors: [] });
    expect(rows[0].fixes).toEqual(['Grade from team "3/4G Smith" → 3rd/4th', 'Gender from team "3/4G Smith" → Girls']);
  });

  it("sends back what the person checked under our headings, and reads it the same way", () => {
    const table = splitTable("x,Boys,3rd,R,Sam Lee,4235550101");
    const text = tableText(
      table.map((r) => r.cells),
      ["skip", "gender", "grade", "level", "coachName", "coachCell"],
      false,
    );
    expect(text.split("\n")[0]).toBe("Gender\tGrade\tLevel\tCoach Name\tCoach Cell");
    expect(parseTeamRows(text, { named: false }).rows[0]).toMatchObject({ gender: "Boys", grade: "3", level: "REC", errors: [] });
  });
});
