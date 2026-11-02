// Reading teams pasted from a spreadsheet or a CSV file (SPEC.md section 14): one team per row, in this column order:
// Team, Gender, Grade, Level, Coach first name, Coach last name, Coach cell (the coach is optional). A header row is
// skipped. Commas or tabs between columns; quotes allowed. Pure: no database, so it can be tested on its own.
import { cleanName } from "./auth/validate";
import { normalizeCell } from "./phone";

export const IMPORT_COLUMNS = ["Team", "Gender", "Grade", "Level", "Coach First", "Coach Last", "Coach Cell"] as const;
export const MAX_IMPORT_ROWS = 200;

export type ImportRow = {
  line: number; // row number in what they pasted
  name: string;
  gender: "Boys" | "Girls" | null;
  grade: string | null; // "3" or "3-4" (one grade, or two in a row)
  gradeText: string; // as typed
  level: "COMP" | "REC" | null;
  coach: { first: string; last: string; cell: string } | null;
  altName: string | null; // optional last column ("Bolts")
  errors: string[];
};

// One line into its fields: commas or tabs, "quoted, values" kept whole ("" inside quotes is a quote).
function fields(line: string): string[] {
  const sep = line.includes("\t") ? "\t" : ",";
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

const GENDER: Record<string, "Boys" | "Girls"> = {
  b: "Boys",
  boy: "Boys",
  boys: "Boys",
  m: "Boys",
  male: "Boys",
  g: "Girls",
  girl: "Girls",
  girls: "Girls",
  f: "Girls",
  female: "Girls",
};
const gradeNum = (t: string): number | null => {
  // "5th Grade" → "5": drop "grade", then the ending (st, nd, rd, th).
  const s = t
    .toLowerCase()
    .replace(/grade/g, "")
    .trim()
    .replace(/(st|nd|rd|th)$/, "")
    .trim();
  if (s === "k" || s === "kindergarten" || s === "0") return 0;
  return /^\d{1,2}$/.test(s) && Number(s) >= 1 && Number(s) <= 12 ? Number(s) : null;
};
// "3", "3rd", "3rd Grade", "K", "3/4", "3rd/4th", "3-4" → "3" or "3-4" (two grades must be in a row).
function parseGradeText(t: string): string | null {
  const parts = t
    .split(/[/\-–]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 1) {
    const g = gradeNum(parts[0]);
    return g === null ? null : String(g);
  }
  if (parts.length !== 2) return null;
  const [a, b] = parts.map(gradeNum);
  return a !== null && b !== null && b === a + 1 ? `${a}-${b}` : null;
}

const isHeader = (f: string[]) => /^(team|gender)/i.test(f[0] ?? "") && /gender|grade/i.test(f.join(" "));

// Teams are named from their grade, gender and Head Coach ("4G Epps"; "4G TBD" with none yet), so rows have no Team
// column: Gender, Grade, Level, Coach first, Coach last, Coach cell, Alternate name (`named: false`; the caller makes the
// name). The coach is optional unless `coachRequired`.

export function parseTeamRows(
  text: string,
  opts: { named?: boolean; coachRequired?: boolean } = {},
): { rows: ImportRow[]; tooMany: boolean } {
  const named = opts.named ?? true;
  const coachRequired = opts.coachRequired ?? false;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const rows: ImportRow[] = [];
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const f = fields(raw);
    if (!rows.length && isHeader(f)) return;
    if (f.every((x) => !x)) return;
    const [name = "", g = "", gr = "", lv = "", cf = "", cl = "", cc = "", alt = ""] = named ? f : ["", ...f];
    const errors: string[] = [];
    // Team names: letters, numbers and simple punctuation, starting with a letter or number (never a formula).
    const okName = !named || /^[A-Za-z0-9][A-Za-z0-9 .'&\-,()#/]{0,59}$/.test(name);
    if (!okName) errors.push(name ? "Team name: letters, numbers and simple punctuation (up to 60)" : "No team name");
    const gender = GENDER[g.toLowerCase()] ?? null;
    if (!gender) errors.push("Gender: Boys or Girls");
    const grade = parseGradeText(gr);
    if (!grade) errors.push("Grade: like 3, 3rd, K or 3/4");
    const level = lv.toUpperCase() === "COMP" || lv.toUpperCase() === "REC" ? (lv.toUpperCase() as "COMP" | "REC") : null;
    if (!level) errors.push("Level: COMP or REC");
    let coach: ImportRow["coach"] = null;
    if (coachRequired && !(cf || cl || cc)) errors.push("Head Coach: first name, last name and a 10-digit cell");
    else if (cf || cl || cc) {
      const first = cleanName(cf);
      const last = cleanName(cl);
      const cell = normalizeCell(cc);
      if (!first || !last || !cell)
        errors.push(
          coachRequired
            ? "Head Coach: first name, last name and a 10-digit cell"
            : "Coach: first name, last name and a 10-digit cell (or leave all three blank)",
        );
      else coach = { first, last, cell };
    }
    const altName = alt.trim() || null;
    if (altName && !/^[A-Za-z0-9][A-Za-z0-9 .'&\-,()#/]{0,59}$/.test(altName))
      errors.push("Alternate name: letters, numbers and simple punctuation (up to 60)");
    rows.push({
      altName,
      line: i + 1,
      name: okName ? name.replace(/\s+/g, " ") : name,
      gender,
      grade,
      gradeText: gr,
      level,
      coach,
      errors,
    });
  });
  return { rows: rows.slice(0, MAX_IMPORT_ROWS), tooMany: rows.length > MAX_IMPORT_ROWS };
}
