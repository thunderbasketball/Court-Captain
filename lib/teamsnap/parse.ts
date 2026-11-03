// Turns a TeamSnap registration export into players, plus a list of problems.
// Pure (no database), so it can be tested and run as a dry run before anything is replaced.
import { parseCsv } from "../csv";

export type Player = {
  registrant_id: string;
  registration_id: string;
  first_name: string;
  last_name: string;
  birthdate: string | null; // YYYY-MM-DD
  gender: "Boys" | "Girls";
  grade: string; // 'K', '1' … '12'
  grade_sort: number;
  program: string;
  roster_status: string | null;
  parent1_first: string | null;
  parent1_last: string | null;
  parent1_email: string | null;
  parent1_cell: string | null;
  parent2_first: string | null;
  parent2_last: string | null;
  parent2_email: string | null;
  parent2_cell: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  coach_request: string | null;
  coaching_interest: string | null;
  uniform_needed: boolean | null;
  uniform_size: string | null;
  uniform_number: string | null;
  checkout_type: string | null;
  checkout_detail: string | null;
  total_fees: number | null;
  amount_paid: number | null;
  amount_remaining: number | null;
  notes: string[];
  registered_at: string | null;
  raw: Record<string, string>;
};

export type Problem = { row: number; name?: string; message: string };

export type ParseResult = {
  players: Player[];
  skipped: Problem[]; // rows intentionally left out (e.g. No Roster)
  errors: Problem[]; // block the import
  warnings: Problem[]; // imported, but worth a look
};

type Field = keyof typeof ALIASES;

// Header names are compared after lowercasing and dropping everything but letters and digits.
const ALIASES = {
  registrant_id: ["registrantid", "participantid"],
  registration_id: ["id", "registrationid"],
  first_name: ["first", "firstname", "participantfirstname", "playerfirstname"],
  last_name: ["last", "lastname", "participantlastname", "playerlastname"],
  birthdate: ["birthdate", "dob", "dateofbirth", "birthday"],
  gender: ["gender", "sex"],
  program: ["winterfees", "springfees", "summerfees", "fallfees", "division", "program"],
  roster_status: ["rosterstatus"],
  parent1_first: ["p1fn", "parent1firstname"],
  parent1_last: ["p1ln", "parent1lastname"],
  parent1_email: ["p1email", "parent1email"],
  parent1_cell: ["p1cell", "parent1cell", "parent1phone"],
  parent2_first: ["p2fn", "parent2firstname"],
  parent2_last: ["p2ln", "parent2lastname"],
  parent2_email: ["p2email", "parent2email"],
  parent2_cell: ["p2cell", "parent2cell", "parent2phone"],
  address: ["address", "streetaddress"],
  city: ["city"],
  state: ["state"],
  zip: ["zip", "zipcode", "postalcode"],
  coach_request: ["coachrequest"],
  coaching_interest: ["areyouinterestedincoaching", "interestedincoaching"],
  uniform_needed: ["uniformneeded"],
  uniform_fee: ["newuniformfee", "uniformfee"], // "Uniform Fee" when they were charged for a uniform
  uniform_size: ["uniformsize"],
  uniform_number: ["uniformnumber"],
  checkout_type: ["checkouttype"],
  checkout_detail: ["checkoutdetail"],
  total_fees: ["totalfees"],
  amount_paid: ["amountpaid"],
  amount_remaining: ["amountremaining"],
  registered_at: ["registrationcreatedat"],
} as const;

const REQUIRED: Field[] = ["registrant_id", "first_name", "last_name", "birthdate", "program"];

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

// "4th Girls", "KinderGarten Boys", "K Boys", "10th grade Girls"
const PROGRAM = /^\s*(kinder\w*|k|(\d{1,2})(?:st|nd|rd|th)?)\s*(?:grade\s*)?(boys|girls)\s*$/i;

export function parseProgram(v: string): { grade: string; grade_sort: number; gender: "Boys" | "Girls" } | null {
  const m = v.match(PROGRAM);
  if (!m) return null;
  const n = m[2] ? Number(m[2]) : 0;
  if (n > 12) return null;
  const gender = m[3].toLowerCase() === "boys" ? "Boys" : "Girls";
  return { grade: n === 0 ? "K" : String(n), grade_sort: n, gender };
}

// TeamSnap writes birthdates as midnight UTC shown in Eastern time, i.e. 8 PM (or 7 PM) the evening
// before. A PM time means the real date is the next day. Accepts M-D-YYYY, M/D/YYYY, YYYY-MM-DD.
export function parseBirthdate(v: string): string | null | "invalid" {
  const s = v.trim();
  if (!s) return null;
  let y: number, mo: number, d: number;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?$/i);
    if (!m) return "invalid";
    [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const hour = m[4] ? Number(m[4]) : 0;
    const pm = m[6]?.toUpperCase() === "PM" || (!m[6] && hour >= 12);
    if (m[4] && pm) {
      const next = new Date(Date.UTC(y, mo - 1, d + 1));
      [y, mo, d] = [next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()];
    }
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "invalid";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Age on September 1 of the season's school year.
function ageOnSept1(birthdate: string, schoolYear: number): number {
  const [y, m, d] = birthdate.split("-").map(Number);
  let age = schoolYear - y;
  if (m > 9 || (m === 9 && d > 1)) age--;
  return age;
}

const clean = (v: string | undefined) => {
  const s = (v ?? "").trim().replace(/\s+/g, " ");
  return s === "" ? null : s;
};

// "ethan" -> "Ethan"; leaves "McNabb", "Putman III" alone.
const fixCase = (s: string) => (s === s.toLowerCase() ? s.replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()) : s);

const money = (v: string | undefined) => {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function cellOf(v: string | undefined, label: string, warn: (m: string) => void): string | null {
  const s = clean(v);
  if (!s) return null;
  let digits = s.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) warn(`${label} "${s}" isn't a 10-digit number.`);
  return digits || null;
}

function emailOf(v: string | undefined, label: string, warn: (m: string) => void): string | null {
  const s = clean(v)?.toLowerCase() ?? null;
  if (!s) return null;
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s)) warn(`${label} "${s}" doesn't look like an email.`);
  else if (/\.con$|@gmil\.|@gmal\.|@gmial\.|@gamil\.|@yaho\.|@hotmial\./.test(s)) warn(`${label} "${s}" looks like a typo.`);
  return s;
}

// Takes CSV text, or rows already split into cells (e.g. read from the Google Sheet).
export function parseRegistrations(input: string | string[][], opts: { schoolYear: number }): ParseResult {
  const result: ParseResult = { players: [], skipped: [], errors: [], warnings: [] };
  const rows = typeof input === "string" ? parseCsv(input) : input;
  if (rows.length < 2) {
    result.errors.push({ row: 1, message: "The file has no data rows." });
    return result;
  }

  // Header names, with repeats numbered so nothing is lost in raw.
  const headers = rows[0].map((h) => h.trim());
  const rawKeys: string[] = [];
  const seen = new Map<string, number>();
  for (const h of headers) {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    rawKeys.push(n === 1 ? h : `${h} (${n})`);
  }

  const col: Partial<Record<Field, number>> = {};
  const normalized = headers.map(norm);
  for (const field of Object.keys(ALIASES) as Field[]) {
    const i = normalized.findIndex((h) => (ALIASES[field] as readonly string[]).includes(h));
    if (i >= 0) col[field] = i;
  }
  // Season fee column has a different name each season: find it by its contents if needed.
  if (col.program === undefined) {
    let best = -1;
    let bestHits = 0;
    headers.forEach((_, i) => {
      const hits = rows.slice(1).filter((r) => parseProgram(r[i] ?? "")).length;
      if (hits > bestHits) [best, bestHits] = [i, hits];
    });
    if (best >= 0) col.program = best;
  }
  const noteCols = normalized.flatMap((h, i) => (h === "registrationnote" ? [i] : []));

  const missing = REQUIRED.filter((f) => col[f] === undefined);
  if (missing.length) {
    result.errors.push({ row: 1, message: `Missing column(s): ${missing.join(", ")}. Is this the TeamSnap registration export?` });
    return result;
  }

  const ids = new Set<string>();
  rows.slice(1).forEach((r, idx) => {
    const rowNum = idx + 2;
    const get = (f: Field) => (col[f] === undefined ? undefined : r[col[f]!]);
    const first = clean(get("first_name"));
    const last = clean(get("last_name"));
    const name = [first, last].filter(Boolean).join(" ") || `row ${rowNum}`;
    const warn = (message: string) => result.warnings.push({ row: rowNum, name, message });
    const fail = (message: string) => result.errors.push({ row: rowNum, name, message });

    const rosterStatus = clean(get("roster_status"));
    const programText = clean(get("program"));
    if ((rosterStatus && /no roster/i.test(rosterStatus)) || !programText) {
      result.skipped.push({ row: rowNum, name, message: rosterStatus && /no roster/i.test(rosterStatus) ? "No Roster" : "No program/grade" });
      return;
    }

    const registrantId = clean(get("registrant_id"));
    if (!registrantId) return fail("Missing Registrant Id.");
    if (ids.has(registrantId)) return fail(`Registrant Id ${registrantId} appears twice.`);
    ids.add(registrantId);
    if (!first || !last) return fail("Missing first or last name.");

    const program = parseProgram(programText);
    if (!program) return fail(`Can't read grade from "${programText}".`);

    const genderCol = clean(get("gender"))?.toLowerCase();
    if (genderCol && !((genderCol.startsWith("m") && program.gender === "Boys") || (genderCol.startsWith("f") && program.gender === "Girls"))) {
      warn(`Gender "${get("gender")}" doesn't match program "${programText}". Using the program.`);
    }

    const bd = parseBirthdate(get("birthdate") ?? "");
    if (bd === "invalid") return fail(`Can't read birthdate "${get("birthdate")}".`);
    if (!bd) warn("No birthdate.");
    else {
      const age = ageOnSept1(bd, opts.schoolYear);
      const expected = program.grade_sort + 5;
      if (Math.abs(age - expected) > 1) warn(`Birthdate ${bd} (age ${age}) is unusual for ${programText}.`);
    }

    const interest = clean(get("coaching_interest"));
    // Ordered a uniform: they answered YES, or they were charged the Uniform Fee (the Director adds the fee when a family
    // answered NO by mistake).
    const uniformNeeded = clean(get("uniform_fee")) ? "YES" : clean(get("uniform_needed"))?.toUpperCase();
    const registeredAt = clean(get("registered_at"));

    result.players.push({
      registrant_id: registrantId,
      registration_id: clean(get("registration_id")) ?? registrantId,
      first_name: fixCase(first),
      last_name: fixCase(last),
      birthdate: bd,
      gender: program.gender,
      grade: program.grade,
      grade_sort: program.grade_sort,
      program: programText,
      roster_status: rosterStatus,
      parent1_first: clean(get("parent1_first")),
      parent1_last: clean(get("parent1_last")),
      parent1_email: emailOf(get("parent1_email"), "Parent 1 email", warn),
      parent1_cell: cellOf(get("parent1_cell"), "Parent 1 cell", warn),
      parent2_first: clean(get("parent2_first")),
      parent2_last: clean(get("parent2_last")),
      parent2_email: emailOf(get("parent2_email"), "Parent 2 email", warn),
      parent2_cell: cellOf(get("parent2_cell"), "Parent 2 cell", warn),
      address: clean(get("address")),
      city: clean(get("city")),
      state: clean(get("state")),
      zip: clean(get("zip")),
      coach_request: clean(get("coach_request")),
      coaching_interest: interest && !/^no$/i.test(interest) ? interest : null,
      uniform_needed: uniformNeeded === "YES" ? true : uniformNeeded === "NO" ? false : null,
      uniform_size: clean(get("uniform_size")),
      uniform_number: clean(get("uniform_number")),
      checkout_type: clean(get("checkout_type")),
      checkout_detail: clean(get("checkout_detail")),
      total_fees: money(get("total_fees")),
      amount_paid: money(get("amount_paid")),
      amount_remaining: money(get("amount_remaining")),
      notes: noteCols.map((i) => clean(r[i])).filter((n): n is string => !!n),
      registered_at: registeredAt ? new Date(registeredAt.replace(" UTC", "Z").replace(" ", "T")).toISOString() : null,
      raw: Object.fromEntries(rawKeys.map((k, i) => [k, r[i] ?? ""])),
    });
  });

  return result;
}

// School year a season belongs to: Jun–Dec counts as that year, Jan–May as the year before.
export function schoolYearOf(date: Date): number {
  return date.getMonth() >= 5 ? date.getFullYear() : date.getFullYear() - 1;
}
