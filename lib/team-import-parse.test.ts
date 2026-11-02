import { describe, expect, it } from "vitest";
import { parseTeamRows } from "./team-import-parse";

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
      "Grade: like 3, 3rd, K or 3/4",
      "Level: COMP or REC",
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
