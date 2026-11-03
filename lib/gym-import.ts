// Importing gyms (SPEC.md section 14), pasted from a spreadsheet or from a CSV file: one gym per row, Gym, Short name,
// Courts. Courts is a number (1–12; named Main, Aux, Court 3… for an organization, Goal #1, Goal #2… for Thunder) or
// the court names separated by "/" or ";". A preview first, then the new gyms are added through the same rules as + Add.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { addOrgGym } from "./facilities";
import { hasArea, orgHasArea } from "./org-admin";
import { addGym } from "./practice/admin";
import { MAX_IMPORT_ROWS } from "./team-import-parse";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type GymImportRow = {
  line: number;
  name: string;
  short: string;
  courts: string[];
  errors: string[];
  status: "new" | "exists" | "error";
};

// One line into its fields: commas or tabs, "quoted, values" kept whole.
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

const PLACE = /^[A-Za-z0-9][A-Za-z0-9 .'&\-,()#/]{0,59}$/; // never a formula
const courtNames = (n: number, thunder: boolean) =>
  Array.from({ length: n }, (_, i) => (thunder ? `Goal #${i + 1}` : i === 0 ? "Main" : i === 1 ? "Aux" : `Court ${i + 1}`));

export function parseGymRows(text: string, thunder: boolean): { rows: Omit<GymImportRow, "status">[]; tooMany: boolean } {
  const rows: Omit<GymImportRow, "status">[] = [];
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((raw, i) => {
      if (!raw.trim()) return;
      const f = fields(raw);
      if (!rows.length && /^gym/i.test(f[0] ?? "") && /court|short/i.test(f.join(" "))) return; // a header row
      const [name = "", short = "", c = ""] = f;
      const errors: string[] = [];
      if (!PLACE.test(name)) errors.push(name ? "Gym name: letters, numbers and simple punctuation (up to 60)" : "No gym name");
      if (!thunder && !/^[A-Za-z0-9][A-Za-z0-9 .&-]{0,7}$/.test(short)) errors.push("Short name: up to 8 letters or numbers");
      let courts: string[] = [];
      if (/^\d{1,2}$/.test(c || "") && Number(c) >= 1 && Number(c) <= 12) courts = courtNames(Number(c), thunder);
      else if (!c) courts = courtNames(thunder ? 2 : 1, thunder);
      else
        courts = c
          .split(/[/;]/)
          .map((x) => x.trim())
          .filter(Boolean);
      if (!courts.length || courts.length > 12 || courts.some((x) => !PLACE.test(x)))
        errors.push("Courts: a number (1–12) or names like Main/Aux");
      else if (new Set(courts.map((x) => x.toLowerCase())).size !== courts.length)
        errors.push("Courts: each needs a different name");
      rows.push({ line: i + 1, name, short, courts, errors });
    });
  return { rows: rows.slice(0, MAX_IMPORT_ROWS), tooMany: rows.length > MAX_IMPORT_ROWS };
}

// Who may: Thunder's Directors of Facilities; another organization's Admins and Directors of Facilities.
const mayImport = async (deps: Deps, viewer: SessionUser, org: string) =>
  org === "thunder" ? hasArea(viewer, "facilities", "practices") : orgHasArea(deps.pool, viewer.coachId, org, "facilities");

async function previewRows(deps: Deps, org: string, text: string) {
  const thunder = org === "thunder";
  const { rows, tooMany } = parseGymRows(text, thunder);
  const have = await deps.pool.query<{ name: string; short: string | null }>(
    "select lower(name) as name, lower(short_name) as short from gyms where org = $1 and active",
    [org],
  );
  const names = new Set(have.rows.map((r) => r.name));
  const shorts = new Set(have.rows.map((r) => r.short).filter(Boolean));
  const seen = new Set<string>();
  const seenShort = new Set<string>();
  return {
    tooMany,
    rows: rows.map((r): GymImportRow => {
      const errors = [...r.errors];
      if (seen.has(r.name.toLowerCase())) errors.push("Listed twice");
      const exists = names.has(r.name.toLowerCase());
      // A gym already there keeps its own short name; a new one can't take another gym's.
      if (!thunder && !exists && r.short && (seenShort.has(r.short.toLowerCase()) || shorts.has(r.short.toLowerCase())))
        errors.push("Short name already used");
      seen.add(r.name.toLowerCase());
      if (r.short) seenShort.add(r.short.toLowerCase());
      return { ...r, errors, status: errors.length ? "error" : exists ? "exists" : "new" };
    }),
  };
}

const check = (text: unknown) =>
  typeof text !== "string" || !text.trim()
    ? "Paste your gyms or choose a CSV file."
    : text.length > 200_000
      ? "That's too much at once. Up to 200 gyms."
      : null;

export async function previewGymImport(
  deps: Deps,
  viewer: SessionUser,
  org: string,
  text: unknown,
): Promise<Result<{ rows: GymImportRow[]; tooMany: boolean }>> {
  if (!(await mayImport(deps, viewer, org)))
    return { ok: false, message: "Only an Admin or Director of Facilities can do that." };
  const bad = check(text);
  if (bad) return { ok: false, message: bad };
  return { ok: true, ...(await previewRows(deps, org, text as string)) };
}

// Adds each new gym through the same rules as + Add (each in its own transaction); skipped rows are named.
export async function importGyms(
  deps: Deps,
  viewer: SessionUser,
  org: string,
  text: unknown,
): Promise<Result<{ added: string[]; skipped: string[] }>> {
  if (!(await mayImport(deps, viewer, org)))
    return { ok: false, message: "Only an Admin or Director of Facilities can do that." };
  const bad = check(text);
  if (bad) return { ok: false, message: bad };
  const { rows } = await previewRows(deps, org, text as string);
  const added: string[] = [];
  const skipped: string[] = [];
  for (const r of rows) {
    if (r.status !== "new") {
      skipped.push(`${r.name || `Row ${r.line}`}: ${r.status === "exists" ? "already a gym" : r.errors.join("; ")}`);
      continue;
    }
    const res =
      org === "thunder"
        ? await addGym(deps, viewer, { name: r.name, courts: r.courts })
        : await addOrgGym(deps, viewer, org, { name: r.name, short: r.short, courts: r.courts });
    if (res.ok) added.push(r.name);
    else skipped.push(`${r.name}: ${res.message}`);
  }
  return { ok: true, added, skipped };
}
