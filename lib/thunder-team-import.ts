// Importing Thunder teams (SPEC.md section 14): rows of Gender, Grade, Level and Head Coach (first, last, cell), pasted
// or from a CSV. Each team is named by Thunder's rule from its grade, gender and Head Coach ("4G Epps"). A preview
// first, then the new ones are added in one go (as a batch that can be undone). Directors of Teams only.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasArea } from "./org-admin";
import { parseTeamRows, type ImportRow } from "./team-import-parse";
import { baseName, existingTeams, namePlanner, tbdBase, teamName } from "./team-names";
import { settleThunderName, thunderTeamName } from "./teams";
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
  const { rows, tooMany } = parseTeamRows(text, { named: false, cellOptional: true });
  const teams = (
    await q.query<{ id: string; name: string; level: string; alt: string | null }>(
      "select id::text, name, level, lower(alt_name) as alt from teams",
    )
  ).rows;
  // A team is already there by its name (numbered or not) and level, or (no coach yet, so no name to match) by its
  // Alternate name.
  const there = existingTeams(teams);
  const alts = new Set(teams.filter((t) => t.alt).map((t) => t.alt!));
  // Each new team's name, numbered when the same as another's ("3G Campbell 1", "3G Campbell 2").
  const plan = namePlanner(teams);
  const seenAlt = new Set<string>();
  const out: ThunderImportRow[] = rows.map((r, i) => {
    const grades = r.grade ? gradesOf(r.grade) : null;
    const base = r.gender && grades ? (r.coach ? teamName(r.gender, grades, r.coach.last) : tbdBase(r.gender, grades)) : "";
    const alt = !r.coach && r.altName ? r.altName.toLowerCase() : "";
    const errors = [...r.errors, ...(alt && seenAlt.has(alt) ? ["Listed twice"] : [])];
    if (alt) seenAlt.add(alt);
    const status = errors.length ? "error" : (r.coach ? there(base, r.level) : !!alt && alts.has(alt)) ? "exists" : "new";
    const fixes = status === "new" ? [...r.fixes, ...plan.add(`row:${i}`, base)] : r.fixes;
    if (status === "new" && r.coach && !r.coach.cell)
      fixes.push(`${r.coach.first} ${r.coach.last} has no cell yet: the team waits for it (COACH CELL MUST BE ENTERED)`);
    return { ...r, name: base, fixes, errors, gradeLabel: grades ? gradeText(grades) : null, status };
  });
  // Names as they'll be once every row is added (a later row can number an earlier one).
  return { rows: out.map((r, i) => (r.status === "new" ? { ...r, name: plan.nameOf(`row:${i}`) } : r)), tooMany };
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
      // With a cell: their login (made if new). Without one yet: the team waits for it, named for them.
      const c = r.coach;
      const m = c?.cell
        ? await matchOrCreateUser(q, { first: c.first, last: c.last, cell: c.cell, email: c.email }, deps.now())
        : null;
      if (m && "error" in m) {
        skipped.push(`${r.name}: ${m.error}`);
        continue;
      }
      if (m && c?.email) await q.query("update users set email = $2 where coach_id = $1 and email is null", [m.coachId, c.email]);
      const waiting = c && !c.cell ? c : null;
      const grades = gradesOf(r.grade!);
      // The Head Coach's last name as it is on their login; with none yet, "4G TBD". Numbered when taken.
      const last = m?.lastName ?? waiting?.last;
      const name = await thunderTeamName(q, last ? teamName(r.gender!, grades, last) : tbdBase(r.gender!, grades), null);
      const t = await q.query<{ id: string }>(
        `insert into teams (name, gender, grades, grade_sort, level, created_at, created_by, import_id, alt_name, coach_first, coach_last)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (name) do nothing returning id::text`,
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
          waiting?.first ?? null,
          waiting?.last ?? null,
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
    // As named now: a later team can have numbered an earlier one ("3G Campbell 1").
    const names = await q.query<{ name: string }>("select name from teams where import_id = $1 order by id", [batch]);
    return { ok: true as const, added: names.rows.map((x) => x.name), skipped };
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
    // A team left alone with a numbered name drops its number.
    for (const b of new Set(removed.map(baseName))) await settleThunderName(q, b);
    if (!kept.length)
      await q.query("update org_team_imports set undone_by = $2, undone_at = $3 where id = $1", [
        importId,
        by(viewer),
        deps.now(),
      ]);
    return { ok: true as const, removed, kept };
  });
}
