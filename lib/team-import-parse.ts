// Reading teams pasted from a spreadsheet or a CSV file (SPEC.md section 14): one team per row. Columns are matched by
// their heading (many ways of writing each), else guessed from what's in them, else taken in this order: [Team or
// Organization,] Gender, Grade, Level, Coach First, Coach Last, Coach Cell, Alternate Team Name. The Import pop-up shows the
// match so the person can change it; it then sends the rows back under our own headings. Values are cleaned up ("3 & 4"
// → 3rd/4th, "R" → REC, "b" → Boys, "thomas battle" → Thomas Battle) and each change is noted for the preview.
// Commas or tabs between columns; quotes allowed. Pure: no database, so the browser and tests use it too.
import { cleanName } from "./auth/validate";
import { normalizeCell } from "./phone";

export const MAX_IMPORT_ROWS = 200;

export type ImportField =
  | "name" // the team's name (named imports) or Scenic City's club
  | "team" // a team name like "4G Epps" or "3/4B Lee": its grade and gender fill in missing ones
  | "gender"
  | "grade"
  | "level"
  | "coachFirst"
  | "coachLast"
  | "coachName" // first and last together ("Sam Lee" or "Lee, Sam")
  | "coachCell"
  | "altName"
  | "skip";

export type ImportRow = {
  line: number; // row number in what they pasted
  name: string;
  gender: "Boys" | "Girls" | null;
  grade: string | null; // "3" or "3-4" (one grade, or two in a row)
  gradeText: string; // as typed
  level: "COMP" | "REC" | null;
  coach: { first: string; last: string; cell: string } | null;
  altName: string | null; // optional ("Bolts")
  fixes: string[]; // what was cleaned up: 'Grade "3 & 4" → 3rd/4th'
  errors: string[];
};

// The fields an import offers, in the order a sheet usually has them. `nameLabel`: "Team" or "Organization" (named).
export function importFields(named: boolean, nameLabel = "Team"): { key: ImportField; label: string }[] {
  return [
    ...(named ? [{ key: "name" as const, label: nameLabel }] : [{ key: "team" as const, label: "Team (like 4G Epps)" }]),
    { key: "gender", label: "Gender" },
    { key: "grade", label: "Grade" },
    { key: "level", label: "Level" },
    { key: "coachFirst", label: "Coach First" },
    { key: "coachLast", label: "Coach Last" },
    { key: "coachName", label: "Coach Name" },
    { key: "coachCell", label: "Coach Cell" },
    { key: "altName", label: "Alternate Team Name" },
    { key: "skip", label: "Don't import" },
  ];
}
const POSITIONAL: ImportField[] = ["gender", "grade", "level", "coachFirst", "coachLast", "coachCell", "altName"];

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
  return out.map((f) => f.replace(/ /g, " ").trim());
}

// What they pasted as rows of cells (blank rows left out), each with its line number.
export function splitTable(text: string): { line: number; cells: string[] }[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((raw, i) => ({ line: i + 1, cells: raw.trim() ? fields(raw) : [] }))
    .filter((r) => r.cells.some(Boolean));
}

// ---- Cleaning one value ----

const GIRLS = /^(g|f|w)$|girl|female|women|lady|ladies/;
const BOYS = /^(b|m)$|boy|\bmale|\bmens?\b/;
// Letters to add, remove, change or swap to turn one word into another.
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

export function cleanGender(t: string): "Boys" | "Girls" | null {
  const s = t.toLowerCase().trim();
  if (!s || /co-?ed/.test(s)) return null;
  if (GIRLS.test(s)) return "Girls";
  if (BOYS.test(s)) return "Boys";
  // A misspelling within two letters of Girl(s) or Boy(s) ("Grils", "Bosy"); not a color like Black, Blue or Gold.
  const near = (words: string[]) => s[0] === words[0][0] && words.some((w) => editDistance(s, w) <= 2);
  return near(["girls", "girl"]) ? "Girls" : near(["boys", "boy"]) ? "Boys" : null;
}

// `inLevelColumn`: the column is Level, and there are only two, so any word starting with R is REC and C is COMP ("Com",
// "Rc"). Guessing which column is Level stays strict, so names like Carter or Robinson aren't taken for levels.
export function cleanLevel(t: string, inLevelColumn = false): "COMP" | "REC" | null {
  const s = t.toLowerCase().replace(/[^a-z]/g, "");
  if (s === "r" || s.startsWith("rec")) return "REC";
  if (s === "c" || s.startsWith("comp") || ["travel", "select", "elite", "aau"].includes(s)) return "COMP";
  if (inLevelColumn && /^r[a-z]{0,11}$/.test(s)) return "REC";
  if (inLevelColumn && /^c[a-z]{0,11}$/.test(s)) return "COMP";
  return null;
}

const ordinal = (g: string) => (g === "0" ? "K" : `${g}${["", "st", "nd", "rd"][Number(g)] ?? "th"}`);
// "3" or "3-4" → "3rd" or "3rd/4th".
export const gradeWords = (grade: string) => grade.split("-").map(ordinal).join("/");

// Any common way of writing one grade or two in a row: "3", "3rd", "3rd Grade", "K", "3/4", "3 & 4", "3rd and 4th",
// "3-4", "4,3", "Grades 3 to 4". A gender written with it ("5B", "5th Boys") is passed back too.
export function cleanGrade(t: string): { grade: string | null; gender: "Boys" | "Girls" | null } {
  let s = t
    .normalize("NFKC") // full-width digits → 0-9
    .replace(/[\u200b-\u200d\ufeff]/g, "") // hidden characters from copying
    .toLowerCase()
    .replace(/(\d)o|o(\d)/g, (_m, a?: string, b?: string) => (a ? `${a}0` : `0${b}`)) // a letter O typed for zero: "1O"
    .replace(/(\d+)\.0+\b/g, "$1") // a spreadsheet number: "10.0"
    .replace(/kindergarten|kinder/g, "k");
  let gender: "Boys" | "Girls" | null = null;
  const word = s.match(/\b(boys?|girls?)\b/);
  const letter = s.match(/(?:\d|\bk)\s*(?:st|nd|rd|th)?\s*([bg])\b/);
  if (word) gender = word[1].startsWith("b") ? "Boys" : "Girls";
  else if (letter) gender = letter[1] === "b" ? "Boys" : "Girls";
  s = s
    .replace(/\b(boys?|girls?)\b/g, " ")
    .replace(/((?:\d|\bk)\s*(?:st|nd|rd|th)?)\s*[bg]\b/g, "$1")
    .replace(/grades?|\bgr\b\.?/g, " ")
    .replace(/(\d)\s*(st|nd|rd|th)\b/g, "$1");
  const tokens = s.match(/\d{1,2}|\bk\b/g) ?? [];
  // Anything left must be a separator: / - – & + , and to thru through.
  const rest = s.replace(/\d{1,2}|\bk\b/g, " ").replace(/[/\-–&+,.]|\b(and|to|thru|through)\b/g, " ");
  if (rest.trim() || !tokens.length || tokens.length > 2) return { grade: null, gender };
  const nums = tokens.map((x) => (x === "k" ? 0 : Number(x))).sort((a, b) => a - b);
  if (nums.some((n) => n > 12)) return { grade: null, gender };
  if (nums.length === 1) return { grade: String(nums[0]), gender };
  return { grade: nums[1] === nums[0] + 1 ? `${nums[0]}-${nums[1]}` : null, gender };
}

// "thomas" or "THOMAS" → "Thomas"; names already mixed case are left as typed.
const fixCase = (s: string) =>
  s === s.toLowerCase() || s === s.toUpperCase()
    ? s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
    : s;

// "Sam Lee", "Lee, Sam", "Coach Sam Lee" → first and last.
function splitName(t: string): { first: string; last: string } {
  const s = t.replace(/^(coach|head coach)\s+/i, "").trim();
  if (s.includes(",")) {
    const [last, first] = s.split(",", 2).map((x) => x.trim());
    return { first, last };
  }
  const i = s.lastIndexOf(" ");
  return i < 0 ? { first: s, last: "" } : { first: s.slice(0, i).trim(), last: s.slice(i + 1) };
}

// ---- Matching columns ----

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const HEADINGS: Record<Exclude<ImportField, "skip" | "name" | "team">, string[]> = {
  gender: ["gender", "sex", "boysgirls", "boysorgirls"],
  grade: ["grade", "grades", "gr", "gradelevel", "class"],
  level: ["level", "reccomp", "recorcomp", "type", "teamtype", "competitionlevel"],
  coachFirst: ["coachfirst", "coachfirstname", "headcoachfirst", "headcoachfirstname", "first", "firstname"],
  coachLast: ["coachlast", "coachlastname", "headcoachlast", "headcoachlastname", "last", "lastname"],
  coachName: ["coach", "coachname", "headcoach", "headcoachname", "name", "fullname", "coachfullname"],
  coachCell: ["coachcell", "cell", "phone", "mobile", "cellphone", "phonenumber", "coachphone", "headcoachcell", "number"],
  altName: ["alternateteamname", "altteamname", "alternatename", "altname", "alternate", "nickname", "mascot", "teamnickname"],
};
const NAME_HEADINGS = ["team", "teamname", "organization", "org", "club", "school", "organizationname", "clubname"];

function headingField(cell: string, named: boolean): ImportField | null {
  const n = norm(cell);
  if (!n) return null;
  if (NAME_HEADINGS.includes(n)) return named ? "name" : "team";
  if (!named && n.startsWith("teamlike")) return "team"; // our own "Team (like 4G Epps)"
  for (const [k, list] of Object.entries(HEADINGS)) if (list.includes(n)) return k as ImportField;
  if (/email|dob|birth|address|zip|notes?$|paid|fee/.test(n)) return "skip";
  return null;
}

// What a column's values look like: most of the filled ones are genders, grades, levels or cells.
function contentField(values: string[]): ImportField | null {
  const filled = values.filter(Boolean);
  if (!filled.length) return null;
  const most = (ok: (v: string) => boolean) => filled.filter(ok).length >= Math.ceil(filled.length * 0.7);
  if (most((v) => !!normalizeCell(v) && /\d{3}/.test(v))) return "coachCell";
  if (most((v) => !!cleanGender(v) && v.length <= 8)) return "gender";
  if (most((v) => !!cleanLevel(v))) return "level";
  if (most((v) => !!cleanGrade(v).grade)) return "grade";
  if (most((v) => /^(k|\d{1,2})(\s*[/&-]\s*\d{1,2})?\s*[bg]\b/i.test(v))) return "team";
  return null;
}

// Each column's field: by heading when the first row is headings, else from its values, else in the usual order.
export function guessColumns(table: { cells: string[] }[], named: boolean): { header: boolean; columns: ImportField[] } {
  const width = Math.max(0, ...table.map((r) => r.cells.length));
  const first = table[0]?.cells ?? [];
  const byHeading = first.map((c) => headingField(c, named));
  const header = byHeading.filter((f) => f && f !== "skip").length >= 2;
  const data = (header ? table.slice(1) : table).slice(0, 50);
  const order: ImportField[] = [...(named ? ["name" as const] : []), ...POSITIONAL];
  let columns: (ImportField | null)[];
  // A column with no heading takes its usual place.
  if (header) columns = Array.from({ length: width }, (_, i) => byHeading[i] ?? (first[i] ? "skip" : (order[i] ?? "skip")));
  else {
    // No headings: the usual order, unless the values clearly say otherwise (then the other columns, which are text,
    // take what's left in the usual order).
    const usual = Array.from({ length: width }, (_, i) => order[i] ?? "skip");
    const sniffed = usual.map((_, i) => contentField(data.map((r) => r.cells[i] ?? "")));
    if (sniffed.every((f, i) => !f || f === usual[i])) columns = usual;
    else {
      const free = order.filter((f) => !sniffed.includes(f) && !["gender", "grade", "level", "coachCell"].includes(f));
      columns = sniffed.map((f) => f ?? free.shift() ?? "skip");
    }
  }
  // A field used twice keeps its first column.
  const seen = new Set<ImportField>();
  return {
    header,
    columns: columns.map((f) => {
      const k = f ?? "skip";
      if (k !== "skip" && seen.has(k)) return "skip";
      seen.add(k);
      return k;
    }),
  };
}

// The rows under our own headings (what the Import pop-up sends after the person checks the columns).
export function tableText(rows: string[][], columns: ImportField[], named: boolean, nameLabel = "Team"): string {
  const labels = Object.fromEntries(importFields(named, nameLabel).map((f) => [f.key, f.label]));
  const keep = columns.map((c, i) => [c, i] as const).filter(([c]) => c !== "skip");
  const cell = (v: string) => {
    const s = v.replace(/[\t\r\n]+/g, " ");
    return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keep.map(([c]) => labels[c]), ...rows.map((r) => keep.map(([, i]) => r[i] ?? ""))]
    .map((r) => r.map(cell).join("\t"))
    .join("\n");
}

// ---- Reading rows ----

const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9 .'&\-,()#/]{0,59}$/;

// Teams are named from their grade, gender and Head Coach ("4G Epps"; "4G TBD" with none yet), so most imports have no
// Team column (`named: false`; the caller makes the name). Named imports (Scenic City's clubs) start with the name.
// The coach is optional unless `coachRequired`.
export function parseTeamRows(
  text: string,
  opts: { named?: boolean; coachRequired?: boolean } = {},
): { rows: ImportRow[]; tooMany: boolean } {
  const named = opts.named ?? true;
  const coachRequired = opts.coachRequired ?? false;
  const table = splitTable(text);
  const { header, columns } = guessColumns(table, named);
  const rows: ImportRow[] = (header ? table.slice(1) : table).map(({ line, cells }) => {
    const v = (f: ImportField) => {
      const i = columns.indexOf(f);
      return i < 0 ? "" : (cells[i] ?? "");
    };
    const errors: string[] = [];
    const fixes: string[] = [];
    const name = v("name").replace(/\s+/g, " ");
    // Team names: letters, numbers and simple punctuation, starting with a letter or number (never a formula).
    const okName = !named || NAME_OK.test(name);
    if (!okName) errors.push(name ? "Team name: letters, numbers and simple punctuation (up to 60)" : "No team name");

    const g = v("gender");
    const gr = v("grade");
    const fromGrade = cleanGrade(gr);
    let gender = cleanGender(g) ?? (g ? null : fromGrade.gender);
    let grade = fromGrade.grade;
    if (gender && g && g !== gender) fixes.push(`Gender "${g}" → ${gender}`);
    if (gender && !g && fromGrade.gender) fixes.push(`Gender from grade "${gr}" → ${gender}`);
    // A team name like "4G Epps" fills in a missing grade or gender.
    const team = v("team");
    const m = team.match(/^(k|\d{1,2})(?:\s*[/&-]\s*(\d{1,2}))?\s*([bg])\b/i);
    if (m && (!gr || !g)) {
      const fromTeam = cleanGrade(m[2] ? `${m[1]}-${m[2]}` : m[1]).grade;
      if (!gr && fromTeam) {
        grade = fromTeam;
        fixes.push(`Grade from team "${team}" → ${gradeWords(fromTeam)}`);
      }
      if (!g && !gender) {
        gender = m[3].toLowerCase() === "b" ? "Boys" : "Girls";
        fixes.push(`Gender from team "${team}" → ${gender}`);
      }
    }
    if (!gender) errors.push("Gender: Boys or Girls");
    if (!grade) errors.push(gr ? `Grade "${gr}": one grade, or two in a row (like 3rd/4th)` : "Grade: like 3, 3rd, K or 3/4");
    else if (gr && !/^(k|\d{1,2})(st|nd|rd|th)?([/-](\d{1,2})(st|nd|rd|th)?)?$/i.test(gr.replace(/grades?|\s/gi, "")))
      fixes.push(`Grade "${gr}" → ${gradeWords(grade)}`);

    const lv = v("level");
    const level = cleanLevel(lv, true);
    if (!level) errors.push(lv ? `Level "${lv}": REC or COMP (R or C is fine)` : "Level: REC or COMP");
    else if (lv.toUpperCase() !== level) fixes.push(`Level "${lv}" → ${level}`);

    let cf = v("coachFirst");
    let cl = v("coachLast");
    const full = v("coachName");
    if (full && !cf && !cl) ({ first: cf, last: cl } = splitName(full));
    const cc = v("coachCell");
    let coach: ImportRow["coach"] = null;
    if (coachRequired && !(cf || cl || cc)) errors.push("Head Coach: first name, last name and a 10-digit cell");
    else if (cf || cl || cc) {
      const first = cleanName(fixCase(cf));
      const last = cleanName(fixCase(cl));
      const cell = normalizeCell(cc);
      if (!first || !last || !cell)
        errors.push(
          coachRequired
            ? "Head Coach: first name, last name and a 10-digit cell"
            : "Coach: first name, last name and a 10-digit cell (or leave all three blank)",
        );
      else {
        coach = { first, last, cell };
        const typed = full && !v("coachFirst") && !v("coachLast") ? full : `${cf} ${cl}`;
        if (typed.replace(/\s+/g, " ").trim() !== `${first} ${last}`) fixes.push(`Coach "${typed.trim()}" → ${first} ${last}`);
      }
    }
    const altName = v("altName").replace(/\s+/g, " ") || null;
    if (altName && !NAME_OK.test(altName)) errors.push("Alternate team name: letters, numbers and simple punctuation (up to 60)");
    return { altName, line, name, gender, grade, gradeText: gr, level, coach, fixes, errors };
  });
  return { rows: rows.slice(0, MAX_IMPORT_ROWS), tooMany: rows.length > MAX_IMPORT_ROWS };
}
