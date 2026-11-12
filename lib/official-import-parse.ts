// Reading officials pasted from a spreadsheet or a CSV file (SPEC.md section 14, step 4c), like the teams import: one
// official per row. Columns are matched by their heading (many ways of writing each), else guessed from what's in them,
// else taken in this order: First, Last, Cell, Email, Level. The import shows the match so the person can change it; it
// then sends the rows back under our own headings. Values are cleaned up ("SMITH" → Smith, "Lee, Sam" → Sam Lee,
// "cert" → Certified, "(423) 555-0101" → 4235550101) and each change is noted for the preview.
// Pure: no database, so the browser and tests use it too.
import { cleanEmail, cleanName } from "./auth/validate";
import { OFFICIAL_LEVELS, type OfficialLevel } from "./official-levels";
import { normalizeCell } from "./phone";
import { splitTable } from "./team-import-parse";

export const MAX_OFFICIAL_ROWS = 300;

export type OfficialField = "first" | "last" | "name" | "cell" | "email" | "level" | "skip";

export const OFFICIAL_FIELDS: { key: OfficialField; label: string }[] = [
  { key: "first", label: "First Name" },
  { key: "last", label: "Last Name" },
  { key: "name", label: "Full Name" },
  { key: "cell", label: "Cell" },
  { key: "email", label: "Email" },
  { key: "level", label: "Level" },
  { key: "skip", label: "Don't import" },
];
const POSITIONAL: OfficialField[] = ["first", "last", "cell", "email", "level"];

export type ParsedOfficial = {
  line: number;
  first: string;
  last: string;
  cell: string | null; // 10 digits
  email: string | null;
  level: OfficialLevel | null;
  fixes: string[];
  errors: string[];
};

// ---- Cleaning one value ----

// "thomas" or "THOMAS" → "Thomas"; names already mixed case are left as typed.
const fixCase = (s: string) =>
  s === s.toLowerCase() || s === s.toUpperCase()
    ? s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
    : s;

// "Sam Lee", "Lee, Sam", "Ref Sam Lee" → first and last.
function splitName(t: string): { first: string; last: string } {
  const s = t.replace(/^(ref|referee|official|mr\.?|mrs\.?|ms\.?)\s+/i, "").trim();
  if (s.includes(",")) {
    const [last, first] = s.split(",", 2).map((x) => x.trim());
    return { first, last };
  }
  const i = s.lastIndexOf(" ");
  return i < 0 ? { first: s, last: "" } : { first: s.slice(0, i).trim(), last: s.slice(i + 1) };
}

// Certified, Experienced, Student or Recruit, from any common way of writing it ("cert", "C", "Experienced", "exp",
// "Student Official", "rookie", "new"). `inLevelColumn`: one letter is enough (C, E, S, R).
export function cleanOfficialLevel(t: string, inLevelColumn = false): OfficialLevel | null {
  const s = t.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  const exact = OFFICIAL_LEVELS.find((l) => l.toLowerCase() === s);
  if (exact) return exact;
  if (s.startsWith("cert")) return "Certified";
  if (s.startsWith("exp") || s === "veteran" || s === "vet") return "Experienced";
  if (s.startsWith("stud")) return "Student";
  if (s.startsWith("recr") || s === "rookie" || s === "new" || s === "trainee" || s === "intraining") return "Recruit";
  if (inLevelColumn && s.length === 1) return ({ c: "Certified", e: "Experienced", s: "Student", r: "Recruit" } as const)[s] ?? null;
  return null;
}

// ---- Matching columns ----

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const HEADINGS: Record<Exclude<OfficialField, "skip">, string[]> = {
  first: ["first", "firstname", "fname", "given", "givenname", "officialfirst", "reffirst", "refereefirst"],
  last: ["last", "lastname", "lname", "surname", "familyname", "officiallast", "reflast", "refereelast"],
  name: ["name", "fullname", "official", "officialname", "referee", "refereename", "ref", "refname"],
  cell: ["cell", "cellphone", "cellnumber", "phone", "phonenumber", "mobile", "mobilephone", "number", "telephone", "tel", "cellphonenumber"],
  email: ["email", "emailaddress", "mail", "eaddress"],
  level: ["level", "officiallevel", "reflevel", "certification", "certlevel", "rank", "status", "class", "type"],
};

function headingField(cell: string): OfficialField | null {
  const n = norm(cell);
  if (!n) return null;
  for (const [k, list] of Object.entries(HEADINGS)) if (list.includes(n)) return k as OfficialField;
  if (/userid|coachid|^id$|dob|birth|address|city|zip|notes?$|paid|fee|age|gender/.test(n)) return "skip";
  return null;
}

// What a column's values look like: most of the filled ones are cells, emails, levels or full names.
function contentField(values: string[]): OfficialField | null {
  const filled = values.filter(Boolean);
  if (!filled.length) return null;
  const most = (ok: (v: string) => boolean) => filled.filter(ok).length >= Math.ceil(filled.length * 0.7);
  if (most((v) => !!normalizeCell(v) && /\d{3}/.test(v))) return "cell";
  if (most((v) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v))) return "email";
  if (most((v) => !!cleanOfficialLevel(v))) return "level";
  if (most((v) => /^\p{L}[\p{L}'’.-]*,?\s+\p{L}[\p{L}'’.\- ]*$/u.test(v))) return "name";
  return null;
}

// Each column's field: by heading when the first row is headings, else from its values, else in the usual order.
export function guessOfficialColumns(table: { cells: string[] }[]): { header: boolean; columns: OfficialField[] } {
  const width = Math.max(0, ...table.map((r) => r.cells.length));
  const first = table[0]?.cells ?? [];
  const byHeading = first.map(headingField);
  const header = byHeading.filter((f) => f && f !== "skip").length >= 2;
  const data = (header ? table.slice(1) : table).slice(0, 50);
  let columns: OfficialField[];
  if (header) columns = Array.from({ length: width }, (_, i) => byHeading[i] ?? "skip");
  else {
    const usual = Array.from({ length: width }, (_, i) => POSITIONAL[i] ?? "skip");
    const sniffed = usual.map((_, i) => contentField(data.map((r) => r.cells[i] ?? "")));
    if (sniffed.every((f, i) => !f || f === usual[i] || (f === "name" && (usual[i] === "first" || usual[i] === "last")))) columns = usual;
    else {
      // Names are text: the columns not sniffed take First and Last (none when a Full Name column was found).
      const free: OfficialField[] = sniffed.includes("name") ? [] : ["first", "last"];
      columns = sniffed.map((f) => (f && f !== "name" ? f : f === "name" && !free.length ? "name" : (free.shift() ?? "skip")));
    }
  }
  // A field used twice keeps its first column; Full Name is left out when First and Last are both there.
  const seen = new Set<OfficialField>();
  const out = columns.map((k) => {
    if (k !== "skip" && seen.has(k)) return "skip";
    seen.add(k);
    return k;
  });
  if (seen.has("first") && seen.has("last")) return { header, columns: out.map((k) => (k === "name" ? "skip" : k)) };
  return { header, columns: out };
}

// The rows under our own headings (what the import sends after the person checks the columns).
export function officialTableText(rows: string[][], columns: OfficialField[]): string {
  const labels = Object.fromEntries(OFFICIAL_FIELDS.map((f) => [f.key, f.label]));
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

export function parseOfficials(text: string): { rows: ParsedOfficial[]; tooMany: boolean } {
  const table = splitTable(text.replace(/^﻿/, ""));
  const { header, columns } = guessOfficialColumns(table);
  const rows = (header ? table.slice(1) : table).map(({ line, cells }): ParsedOfficial => {
    const v = (f: OfficialField) => {
      const i = columns.indexOf(f);
      return i < 0 ? "" : (cells[i] ?? "").replace(/\s+/g, " ").trim();
    };
    const fixes: string[] = [];
    const errors: string[] = [];
    let f = v("first");
    let l = v("last");
    const full = v("name");
    if (full && !f && !l) ({ first: f, last: l } = splitName(full));
    else if (f && !l && f.includes(" ")) ({ first: f, last: l } = splitName(f)); // both names in First
    const first = cleanName(fixCase(f));
    const last = cleanName(fixCase(l));
    if (!first || !last) errors.push("Name: a first and last name (letters only)");
    else {
      const typed = (full && !v("first") && !v("last") ? full : `${v("first")} ${v("last")}`).replace(/\s+/g, " ").trim();
      if (typed !== `${first} ${last}`) fixes.push(`Name "${typed}" → ${first} ${last}`);
    }
    const c = v("cell");
    const cell = normalizeCell(c);
    if (!c) errors.push("Cell: 10 digits (its last 7 are their User ID)");
    else if (!cell) errors.push(`Cell "${c}": 10 digits`);
    const e = v("email");
    const email = e ? cleanEmail(e) : null;
    if (e && !email) errors.push(`Email "${e}" doesn't look right (or leave it blank)`);
    else if (e && email !== e) fixes.push(`Email "${e}" → ${email}`);
    const lv = v("level");
    const level = cleanOfficialLevel(lv, true);
    if (lv && !level) errors.push(`Level "${lv}": Certified, Experienced, Student or Recruit (or leave it blank)`);
    else if (level && lv !== level) fixes.push(`Level "${lv}" → ${level}`);
    return { line, first: first ?? f, last: last ?? l, cell, email, level, fixes, errors };
  });
  return { rows: rows.slice(0, MAX_OFFICIAL_ROWS), tooMany: rows.length > MAX_OFFICIAL_ROWS };
}
