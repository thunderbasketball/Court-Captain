// Importing Thunder teams (SPEC.md section 14): rows of Gender, Grade, Level and Head Coach (first, last, cell), pasted
// or from a CSV. Each team is named by Thunder's rule from its grade, gender and Head Coach ("4G Epps"). A preview
// first, then the new ones are added in one go (as a batch that can be undone). Directors of Teams only.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasArea } from "./org-admin";
import { parseTeamRows, type ImportRow } from "./team-import-parse";
import { tbdName, teamName } from "./team-names";
import { withTx, type Queryable } from "./sql";
import { matchOrCreateUser } from "./user-match";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const directorsOnly = { ok: false as const, message: "Only a Director of Teams can do that." };

// "3-4" → ["3", "4"]; "0" → ["K"].
const gradesOf = (g: string) => g.split("-").map((x) => (x === "0" ? "K" : x));
const gradeText = (gs: string[]) =>
  gs.map((g) => (g === "K" ? "K" : `${g}${["", "st", "nd", "rd"][Number(g)] ?? "th"}`)).join("/");

export type ThunderImportRow = ImportRow & { status: "new" | "exists" | "error"; gradeLabel: string | null };

async function previewRows(q: Pick<Queryable, "query">, text: string) {
  const { rows, tooMany } = parseTeamRows(text, { named: false });
  // A team is already there by its name, or (no coach yet, so no name to match) by its Alternate name.
  const teams = (await q.query<{ name: string; alt: string | null }>("select lower(name) as name, lower(alt_name) as alt from teams")).rows;
  const have = new Set([...teams.map((r) => r.name), ...teams.filter((r) => r.alt).map((r) => `alt:${r.alt}`)]);
  const seen = new Set<string>();
  const out: ThunderImportRow[] = rows.map((r) => {
    const grades = r.grade ? gradesOf(r.grade) : null;
    // The name by the rule; with no Head Coach yet it's "4G TBD" (numbered when added).
    const name = r.gender && grades ? teamName(r.gender, grades, r.coach?.last ?? "TBD") : "";
    const key = r.coach ? name.toLowerCase() : r.altName ? `alt:${r.altName.toLowerCase()}` : "";
    const errors = [...r.errors, ...(key && seen.has(key) ? ["Listed twice"] : [])];
    if (key) seen.add(key);
    return {
      ...r,
      name,
      errors,
      gradeLabel: grades ? gradeText(grades) : null,
      status: errors.length ? "error" : key && have.has(key) ? "exists" : "new",
    };
  });
  return { rows: out, tooMany };
}

const tooBig = (text: unknown) =>
  typeof text !== "string" || !text.trim()
    ? "Paste your teams or choose a CSV file."
    : text.length > 200_000
      ? "That's too much at once. Up to 200 teams."
      : null;

export async function previewThunderImport(
  deps: Deps,
  viewer: SessionUser,
  text: unknown,
): Promise<Result<{ rows: ThunderImportRow[]; tooMany: boolean }>> {
  if (!hasArea(viewer, "teams")) return directorsOnly;
  const bad = tooBig(text);
  if (bad) return { ok: false, message: bad };
  return { ok: true, ...(await previewRows(deps.pool, text as string)) };
}

// Adds the new teams (each named "4G Epps" from its Head Coach, who gets a login if new and the Thunder Coach role).
// Teams already there and rows with problems are skipped and named. Checked again here.
export async function importThunderTeams(
  deps: Deps,
  viewer: SessionUser,
  text: unknown,
): Promise<Result<{ added: string[]; skipped: string[] }>> {
  if (!hasArea(viewer, "teams")) return directorsOnly;
  const bad = tooBig(text);
  if (bad) return { ok: false, message: bad };
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('org-teams:thunder'))");
    const { rows } = await previewRows(q, text as string);
    const batch = (
      await q.query<{ id: string }>(
        "insert into org_team_imports (org, imported_by, imported_at, teams) values ('thunder', $1, $2, 0) returning id::text",
        [by(viewer), deps.now()],
      )
    ).rows[0].id;
    const added: string[] = [];
    const skipped: string[] = [];
    for (const r of rows) {
      if (r.status !== "new") {
        skipped.push(`${r.name || `Row ${r.line}`}: ${r.status === "exists" ? "already a team" : r.errors.join("; ")}`);
        continue;
      }
      const m = r.coach ? await matchOrCreateUser(q, { ...r.coach, email: null }, deps.now()) : null;
      if (m && "error" in m) {
        skipped.push(`${r.name}: ${m.error}`);
        continue;
      }
      const grades = gradesOf(r.grade!);
      // The Head Coach's last name as it is on their login; with none yet, "4G TBD" (numbered).
      const taken = new Set((await q.query<{ name: string }>("select lower(name) as name from teams")).rows.map((x) => x.name));
      const name = m ? teamName(r.gender!, grades, m.lastName) : tbdName(r.gender!, grades, taken);
      const t = await q.query<{ id: string }>(
        `insert into teams (name, gender, grades, grade_sort, level, created_at, created_by, import_id, alt_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (name) do nothing returning id::text`,
        [
          name,
          r.gender,
          grades,
          Math.max(...grades.map((g) => (g === "K" ? 0 : Number(g)))),
          r.level,
          deps.now(),
          by(viewer),
          batch,
          r.altName,
        ],
      );
      if (!t.rows[0]) {
        skipped.push(`${name}: already a team`);
        continue;
      }
      if (m) {
        await q.query(
          "insert into team_staff (team_id, coach_id, role, added_at, added_by) values ($1, $2, 'HeadCoach', $3, $4)",
          [t.rows[0].id, m.coachId, deps.now(), by(viewer)],
        );
        await q.query("select set_role($1, 'thunder', 'Coach', true, $2), set_role($1, 'thunder', 'Request', false, $2)", [
          m.coachId,
          by(viewer),
        ]);
      }
      added.push(name);
    }
    if (added.length) await q.query("update org_team_imports set teams = $2 where id = $1", [batch, added.length]);
    else await q.query("delete from org_team_imports where id = $1", [batch]);
    return { ok: true as const, added, skipped };
  });
}

export type ThunderImport = {
  id: string;
  importedBy: string;
  importedAt: Date;
  teams: number;
  left: number;
  undoneBy: string | null;
};

export async function listThunderImports(deps: Deps, viewer: SessionUser): Promise<ThunderImport[] | null> {
  if (!hasArea(viewer, "teams")) return null;
  const r = await deps.pool.query<ThunderImport>(
    `select i.id::text, i.imported_by as "importedBy", i.imported_at as "importedAt", i.teams, i.undone_by as "undoneBy",
            (select count(*)::int from teams t where t.import_id = i.id) as left
     from org_team_imports i where i.org = 'thunder' order by i.imported_at desc limit 5`,
  );
  return r.rows;
}

// Undo: removes the import's teams still there that have no players and no booked practices (with their staff). The
// others are kept and named (remove their players or practices first).
export async function undoThunderImport(
  deps: Deps,
  viewer: SessionUser,
  importId: unknown,
): Promise<Result<{ removed: string[]; kept: string[] }>> {
  if (!hasArea(viewer, "teams")) return directorsOnly;
  if (!isId(importId)) return { ok: false, message: "That import no longer exists." };
  return withTx(deps.pool, async (q) => {
    const i = await q.query<{ undone_by: string | null }>(
      "select undone_by from org_team_imports where id = $1 and org = 'thunder' for update",
      [importId],
    );
    if (!i.rows[0]) return { ok: false as const, message: "That import no longer exists." };
    if (i.rows[0].undone_by) return { ok: false as const, message: `${i.rows[0].undone_by} already undid it.` };
    const teams = await q.query<{ id: string; name: string; busy: boolean }>(
      `select t.id::text, t.name,
              exists (select 1 from team_players p where p.team_id = t.id) or exists (select 1 from slots s where s.team_id = t.id) as busy
       from teams t where t.import_id = $1 order by t.grade_sort, t.name for update`,
      [importId],
    );
    const removed: string[] = [];
    const kept: string[] = [];
    for (const t of teams.rows) {
      if (t.busy) {
        kept.push(t.name);
        continue;
      }
      await q.query("delete from teams where id = $1", [t.id]);
      removed.push(t.name);
    }
    if (!kept.length)
      await q.query("update org_team_imports set undone_by = $2, undone_at = $3 where id = $1", [
        importId,
        by(viewer),
        deps.now(),
      ]);
    return { ok: true as const, removed, kept };
  });
}
