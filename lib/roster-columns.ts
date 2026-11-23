// Importing a roster from pasted rows or a CSV file: which column holds what. Shared by the Import players form (it
// shows the columns and guesses) and the server (which uses the columns it's sent, after checking them). Pure: no database.

export const COLUMN_KINDS = ["first", "last", "name", "grade", "jersey", "birthdate", "skip"] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];
export const COLUMN_LABEL: Record<ColumnKind, string> = {
  first: "First name",
  last: "Last name",
  name: "Full name",
  grade: "Grade",
  jersey: "Jersey",
  birthdate: "Birthdate",
  skip: "Skip (not used)",
};
// Without columns chosen (older callers): First, Last, Grade, Jersey, Birthdate.
export const DEFAULT_COLUMNS: ColumnKind[] = ["first", "last", "grade", "jersey", "birthdate"];

const DATE = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$|^\d{4}-\d{1,2}-\d{1,2}$/;
const NUM = /^#?\d{1,3}$/;
const GRADE = /^(k|kg|pre-?k|\d{1,2}(st|nd|rd|th)?)$/i;

function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// One row's cells. Tabs (pasted from a spreadsheet) or commas (CSV); otherwise columns lined up with spaces: two or
// more spaces split, and a cell of only numbers and dates ("4  5" squeezed to "4 5") splits on single spaces too.
function cells(line: string, sep: "\t" | "," | " "): string[] {
  const raw = sep === "\t" ? line.split("\t") : sep === "," ? csvFields(line) : line.trim().split(/\s{2,}/);
  const out: string[] = [];
  for (const f of raw.map((x) => x.trim())) {
    const parts = f.split(/\s+/);
    if (sep === " " && parts.length > 1 && parts.every((p) => DATE.test(p) || NUM.test(p))) out.push(...parts);
    else out.push(f);
  }
  return out;
}

// The pasted text as rows of cells (blank lines left out), at most 101 rows (a header and 100 players).
export function splitRows(text: string): string[][] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim());
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : lines.some((l) => l.includes(",")) ? "," : " ";
  const rows = lines.slice(0, 101).map((l) => cells(l, sep));
  // Rows of different lengths (pasted text lined up with extra tabs here and there): the empty cells are spacing, not
  // columns, so they're dropped and each row's values line up. A spreadsheet's rows are all one length and stay as they are.
  const ragged = new Set(rows.map((r) => r.length)).size > 1;
  return ragged ? rows.map((r) => r.filter((c) => c.trim())) : rows;
}

const HEADER: [RegExp, ColumnKind][] = [
  [/^(first|first ?name|given)/i, "first"],
  [/^(last|last ?name|surname|family)/i, "last"],
  [/^(name|full ?name|player|player ?name|athlete)$/i, "name"],
  [/^(grade|gr\.?|grd)$/i, "grade"],
  [/^(jersey|#|no\.?|num|number|uniform)/i, "jersey"],
  [/^(birth|dob|bday|date of birth|birthday)/i, "birthdate"],
];
const headerKind = (cell: string): ColumnKind | null => HEADER.find(([re]) => re.test(cell.trim()))?.[1] ?? null;

// Whether the first row names the columns, and a guess at each column: from those names, else from what's in it
// (dates → Birthdate; numbers K–12 with few different values → Grade, other numbers → Jersey; words with a space →
// Full name; the first and second word columns → First and Last name).
export function guessColumns(rows: string[][]): { columns: ColumnKind[]; header: boolean } {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const first = rows[0] ?? [];
  const named = first.map(headerKind);
  if (named.filter(Boolean).length >= 2)
    return { columns: Array.from({ length: width }, (_, i) => named[i] ?? "skip"), header: true };
  const body = rows.slice(0, 30);
  const columns: ColumnKind[] = Array(width).fill("skip");
  const numeric: { i: number; distinct: number; grade: boolean }[] = [];
  const words: number[] = [];
  for (let i = 0; i < width; i++) {
    const vals = body.map((r) => (r[i] ?? "").trim()).filter(Boolean);
    if (!vals.length) continue;
    const share = (re: RegExp) => vals.filter((v) => re.test(v)).length / vals.length;
    if (share(DATE) >= 0.6) columns[i] = "birthdate";
    else if (share(NUM) >= 0.6 || share(GRADE) >= 0.6)
      numeric.push({
        i,
        distinct: new Set(vals).size,
        grade: vals.every((v) => GRADE.test(v) && (Number.parseInt(v, 10) <= 12 || /^(k|kg|pre-?k)$/i.test(v))),
      });
    else words.push(i);
  }
  // Grade: the column of grades with the fewest different values (a team is one or two grades); the rest are jerseys.
  const grade = numeric.filter((n) => n.grade).sort((a, b) => a.distinct - b.distinct || a.i - b.i)[0];
  for (const n of numeric) columns[n.i] = n === grade ? "grade" : columns.includes("jersey") ? "skip" : "jersey";
  const hasSpace = (i: number) => body.filter((r) => /\s/.test((r[i] ?? "").trim())).length / Math.max(1, body.length) >= 0.6;
  if (words.length === 1 || (words.length > 1 && hasSpace(words[0]))) columns[words[0]] = "name";
  else if (words.length > 1) {
    columns[words[0]] = "first";
    columns[words[1]] = "last";
  }
  return { columns, header: false };
}

const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
// "Josef Rutley II" → Josef, Rutley II; "Mary Ann Smith" → Mary Ann, Smith; "Smith, Ava" → Ava, Smith.
export function splitFullName(full: string): { first: string; last: string } {
  const s = full.trim().replace(/\s+/g, " ");
  if (s.includes(",")) {
    const [last, first] = s.split(",", 2).map((x) => x.trim());
    return { first: first ?? "", last: last ?? "" };
  }
  const w = s.split(" ");
  if (w.length < 2) return { first: s, last: "" };
  const lastAt = w.length > 2 && SUFFIX.test(w[w.length - 1]) ? w.length - 2 : w.length - 1;
  return { first: w.slice(0, lastAt).join(" "), last: w.slice(lastAt).join(" ") };
}

export type RosterCells = { line: number; first: string; last: string; grade: string; jersey: string; birthdate: string };

// The players in the rows, using the chosen columns (unknown ones count as Skip), leaving out a header row.
export function rowsToPlayers(rows: string[][], columns: readonly string[], header: boolean): RosterCells[] {
  const kinds = columns.map((c) => ((COLUMN_KINDS as readonly string[]).includes(c) ? (c as ColumnKind) : "skip"));
  return rows.slice(header ? 1 : 0, (header ? 1 : 0) + 100).map((r, n) => {
    const p: RosterCells = { line: n + (header ? 2 : 1), first: "", last: "", grade: "", jersey: "", birthdate: "" };
    kinds.forEach((k, i) => {
      const v = (r[i] ?? "").trim();
      if (!v || k === "skip") return;
      if (k === "name") Object.assign(p, splitFullName(v));
      else p[k] = v;
    });
    return p;
  });
}

// The chosen columns, checked (the server's copy): known kinds only, at most 20; null when not usable.
export function checkColumns(v: unknown): ColumnKind[] | null {
  if (!Array.isArray(v) || v.length > 20) return null;
  if (!v.every((c) => typeof c === "string" && (COLUMN_KINDS as readonly string[]).includes(c))) return null;
  return v as ColumnKind[];
}
