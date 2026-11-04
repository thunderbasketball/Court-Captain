// Scenic City's own teams for outside clubs (SPEC.md section 13): organizations not on CourtCaptain, kept as partners
// that register teams. A Scenic City Director of Teams adds them one at a time (+ Add) or many at once (Import, which
// can be undone). Organizations on CourtCaptain add their own teams and register them; Scenic City can't add theirs.
// Teams are named like everyone's, with the club's Abbreviation first: "HH 5B Harris" ("HH 5B TBD" until a coach).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { orgHasArea } from "./org-admin";
import { resolveHead, TeamError } from "./org-teams";
import { cleanPlaceName } from "./scenic-partners";
import { gradeLabel, LEVELS, parseGrade } from "./scenic-teams";
import { withTx, type Queryable } from "./sql";
import { parseTeamRows, type ImportRow } from "./team-import-parse";
import {
  baseName,
  existingTeams,
  gradesOk,
  leagueName,
  namePlanner,
  placeName,
  settleName,
  teamName,
  type NamedTeam,
} from "./team-names";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const ORG = "scenic-city";
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const notDirector = "Only a Scenic City Director of Teams can do that.";

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof TeamError) return { ok: false, message: e.message };
    if ((e as { code?: string }).code === "23505") return { ok: false, message: "There's already a team with that name." };
    throw e;
  }
}

const mustDirect = async (q: Pick<Queryable, "query">, viewer: SessionUser) => {
  if (!(await orgHasArea(q, viewer.coachId, ORG, "teams"))) throw new TeamError(notDirector);
};

// A club's Abbreviation when none is given: its initials ("Hixson Hoops" → "HH"), up to 6.
export const clubAbbr = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 6) || "CLUB";

export type Club = { id: string; name: string; abbr: string };

// Outside clubs that register teams, by name.
export async function outsideClubs(q: Pick<Queryable, "query">): Promise<Club[]> {
  const r = await q.query<{ id: string; name: string; abbr: string | null }>(
    "select id::text, name, abbr from partners where org_slug is null and registers_teams and approved order by lower(name)",
  );
  return r.rows.map((c) => ({ ...c, abbr: c.abbr ?? clubAbbr(c.name) }));
}

// The club picked (its id), or a new one typed in ({ name, abbr }): made if new. A club on CourtCaptain is refused.
async function clubFor(q: Pick<Queryable, "query">, viewer: SessionUser, v: unknown): Promise<Club> {
  if (isId(v)) {
    const r = await q.query<Club & { abbr: string | null }>(
      "select id::text, name, abbr from partners where id = $1 and org_slug is null and registers_teams and approved for share",
      [v],
    );
    if (!r.rows[0]) throw new TeamError("Pick an outside club.");
    return { ...r.rows[0], abbr: r.rows[0].abbr ?? clubAbbr(r.rows[0].name) };
  }
  const p = v as { name?: unknown; abbr?: unknown } | null;
  const name = cleanPlaceName(p?.name);
  if (!name) throw new TeamError("Organization: letters, numbers and simple punctuation, up to 60 characters.");
  const typed = typeof p?.abbr === "string" ? p.abbr.trim().toUpperCase() : "";
  if (typed && !/^[A-Z0-9]{1,6}$/.test(typed)) throw new TeamError("Abbreviation: up to 6 letters or numbers.");
  const abbr = typed || clubAbbr(name);
  const had = await q.query<{ id: string; name: string; abbr: string | null; org_slug: string | null }>(
    "select id::text, name, abbr, org_slug from partners where lower(name) = lower($1) for update",
    [name],
  );
  const c = had.rows[0];
  if (c?.org_slug) throw new TeamError(`${c.name} is on CourtCaptain: they add and register their own teams.`);
  if (c) {
    await q.query("update partners set registers_teams = true, approved = true, abbr = coalesce(abbr, $2) where id = $1", [
      c.id,
      abbr,
    ]);
    return { id: c.id, name: c.name, abbr: c.abbr ?? abbr };
  }
  const n = await q.query<{ id: string }>(
    `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, abbr)
     values ($1, 'Organization', false, true, true, $2, $3) returning id::text`,
    [name, by(viewer), abbr],
  );
  return { id: n.rows[0].id, name, abbr };
}

// The team's name by the rule, with the club's Abbreviation first, unique within the club. Lock the club first.
async function clubTeamName(
  q: Pick<Queryable, "query">,
  club: Club,
  gender: "Boys" | "Girls",
  grades: string[],
  last: string | null,
) {
  await q.query("select pg_advisory_xact_lock(hashtext('scenic-club:' || $1))", [club.id]);
  const teams = (await q.query<NamedTeam>("select id::text, name from scenic_teams where partner_id = $1", [club.id])).rows;
  // Numbered, with any of the club's teams already named that ("RA 3G Campbell 1", "RA 3G Campbell 2").
  const { name, renames } = placeName(teams, leagueName(club.abbr, teamName(gender, grades, last ?? "TBD")));
  for (const r of renames) await q.query("update scenic_teams set name = $2 where id = $1", [r.id, r.name]);
  return name;
}

// After a club's team is removed: the one left with its name drops its number.
async function settleClubName(q: Pick<Queryable, "query">, clubId: string, base: string) {
  const teams = (await q.query<NamedTeam>("select id::text, name from scenic_teams where partner_id = $1", [clubId])).rows;
  const s = settleName(teams, base);
  if (s) await q.query("update scenic_teams set name = $2 where id = $1", [s.id, s.name]);
}

const altOf = (v: unknown) => {
  if (typeof v !== "string" || !v.trim()) return null;
  const a = cleanPlaceName(v);
  if (!a) throw new TeamError("Alternate name: letters, numbers and simple punctuation, up to 60 characters.");
  return a;
};

async function insertTeam(
  q: Pick<Queryable, "query">,
  viewer: SessionUser,
  now: Date,
  t: {
    name: string;
    gender: string;
    grades: string[];
    level: string;
    club: Club;
    coachId: string | null;
    alt: string | null;
    importId?: string;
    waiting?: { first: string; last: string } | null; // a Head Coach named without a cell yet
  },
) {
  const nums = t.grades.map((g) => (g === "K" ? 0 : Number(g))).sort((a, b) => a - b);
  const r = await q.query<{ id: string }>(
    `insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, coach_id, created_by, created_at, updated_by, updated_at, alt_name, import_id, coach_first, coach_last)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9, $10, $11, $12, $13) returning id::text`,
    [
      t.name,
      t.gender,
      nums[0],
      nums.at(-1),
      t.level,
      t.club.id,
      t.coachId,
      by(viewer),
      now,
      t.alt,
      t.importId ?? null,
      t.waiting?.first ?? null,
      t.waiting?.last ?? null,
    ],
  );
  if (t.coachId)
    await q.query("select set_role($1, $2, 'Coach', true, $3), set_role($1, $2, 'Request', false, $3)", [
      t.coachId,
      ORG,
      by(viewer),
    ]);
  return r.rows[0].id;
}

export type ClubTeamInput = {
  club?: unknown;
  gender: unknown;
  grades: unknown;
  level: unknown;
  headCoach?: unknown;
  altName?: unknown;
};

// + Add: one team for an outside club (picked, or new), with its Head Coach (picked, new, or none yet).
export async function addClubTeam(
  deps: Deps,
  viewer: SessionUser,
  input: ClubTeamInput,
): Promise<Result<{ id: string; name: string }>> {
  return run(async () => {
    await mustDirect(deps.pool, viewer);
    const gender = input.gender === "Boys" || input.gender === "Girls" ? input.gender : null;
    if (!gender) throw new TeamError("Pick Boys or Girls.");
    const grades = Array.isArray(input.grades) ? [...new Set(input.grades as string[])] : [];
    if (!gradesOk(grades)) throw new TeamError("Pick one grade, or two next to each other.");
    const level = LEVELS.find((l) => l === input.level);
    if (!level) throw new TeamError("Pick COMP or REC.");
    const alt = altOf(input.altName);
    return withTx(deps.pool, async (q) => {
      const club = await clubFor(q, viewer, input.club);
      const head = await resolveHead(q, input.headCoach, deps.now());
      const name = await clubTeamName(q, club, gender, grades, head?.lastName ?? null);
      const id = await insertTeam(q, viewer, deps.now(), {
        name,
        gender,
        grades,
        level,
        club,
        coachId: head?.coachId ?? null,
        alt,
      });
      return { id, name };
    });
  });
}

// Who can be a Head Coach here: Scenic City's coaches (or a new person typed in).
export async function scenicCoachOptions(q: Pick<Queryable, "query">) {
  const r = await q.query<{ id: string; first: string; last: string }>(
    `select coach_id as id, first_name as first, last_name as last from users
     where active and has_role(coach_id, 'scenic-city', 'Coach') order by lower(last_name), lower(first_name)`,
  );
  return r.rows.map((u) => ({ value: `user:${u.id}`, firstName: u.first, lastName: u.last, detail: "Coach" }));
}

// ---- Import: Organization, Gender, Grade, Level, Coach First, Coach Last, Coach Cell, Alternate Name ----

export type ClubImportRow = ImportRow & { status: "new" | "exists" | "error"; gradeLabel: string | null };
const importGrades = (g: string) => g.split("-").map((x) => (x === "0" ? "K" : x));

async function previewRows(q: Pick<Queryable, "query">, text: string) {
  const parsed = parseTeamRows(text, { named: true, cellOptional: true });
  const partners = (
    await q.query<{
      id: string;
      name: string;
      abbr: string | null;
      org_slug: string | null;
      teams: { id: string; name: string; level: string }[];
      alts: string[] | null;
    }>(
      `select p.id::text, p.name, p.abbr, p.org_slug,
              coalesce((select json_agg(json_build_object('id', t.id::text, 'name', t.name, 'level', t.level)) from scenic_teams t
                        where t.partner_id = p.id), '[]') as teams,
              array(select lower(t.alt_name) from scenic_teams t where t.partner_id = p.id and t.alt_name is not null) as alts
       from partners p`,
    )
  ).rows;
  const byName = new Map(partners.map((p) => [p.name.toLowerCase(), p]));
  // Per club: its teams already there (by name, numbered or not, and level) and each new team's name, numbered when the
  // same as another's.
  const clubs = new Map<string, { there: ReturnType<typeof existingTeams>; plan: ReturnType<typeof namePlanner> }>();
  const forClub = (key: string, teams: { id: string; name: string; level: string }[]) => {
    let c = clubs.get(key);
    if (!c) clubs.set(key, (c = { there: existingTeams(teams), plan: namePlanner(teams) }));
    return c;
  };
  const seenAlt = new Set<string>();
  const planned: { club: string; key: string }[] = [];
  const rows: ClubImportRow[] = parsed.rows.map((p, i) => {
    // The first column is the club: errors about a "team name" are about it.
    const errors = p.errors.map((e) =>
      /team name/i.test(e)
        ? p.name
          ? "Organization: letters, numbers and simple punctuation (up to 60)"
          : "No organization"
        : e,
    );
    const club = p.name ? byName.get(p.name.toLowerCase()) : undefined;
    if (club?.org_slug) errors.push(`${club.name} is on CourtCaptain: they add their own teams`);
    const abbr = club?.abbr ?? clubAbbr(p.name);
    const team = p.gender && p.grade ? leagueName(abbr, teamName(p.gender, importGrades(p.grade), p.coach?.last ?? "TBD")) : "";
    const alt = !p.coach && p.altName ? `${p.name.toLowerCase()}|${p.altName.toLowerCase()}` : "";
    if (alt && seenAlt.has(alt)) errors.push("Listed twice");
    if (alt) seenAlt.add(alt);
    const c = forClub(p.name.toLowerCase(), club?.teams ?? []);
    const there =
      !errors.length &&
      (p.coach ? !!club && c.there(team, p.level) : !!club && !!p.altName && !!club.alts?.includes(p.altName.toLowerCase()));
    const status = errors.length ? "error" : there ? "exists" : "new";
    const fixes = status === "new" ? [...p.fixes, ...c.plan.add(`row:${i}`, team)] : p.fixes;
    if (status === "new" && p.coach && !p.coach.cell)
      fixes.push(`${p.coach.first} ${p.coach.last} has no cell yet: the team waits for it (COACH CELL MUST BE ENTERED)`);
    if (status === "new") planned[i] = { club: p.name.toLowerCase(), key: `row:${i}` };
    const g = p.grade ? parseGrade(p.grade) : null;
    return {
      ...p,
      // A club name that can't be used is shown as typed.
      name: team && !errors.some((e) => /organization/i.test(e)) ? `${team} · ${club?.name ?? `${p.name} (new club)`}` : p.name,
      fixes,
      errors,
      gradeLabel: g ? gradeLabel(g.low, g.grade) : null,
      status,
    };
  });
  // Names as they'll be once every row is added (a later row can number an earlier one).
  for (const [i, pl] of planned.entries())
    if (pl) rows[i] = { ...rows[i], name: rows[i].name.replace(/^[^·]+·/, `${clubs.get(pl.club)!.plan.nameOf(pl.key)} ·`) };
  return { rows, tooMany: parsed.tooMany, clubs: parsed.rows.map((r) => r.name) };
}

const checkText = (text: unknown): string => {
  if (typeof text !== "string" || !text.trim()) throw new TeamError("Paste your teams or choose a CSV file.");
  if (text.length > 200_000) throw new TeamError("That's too much at once. Up to 200 teams.");
  return text;
};

export async function previewClubImport(
  deps: Deps,
  viewer: SessionUser,
  text: unknown,
): Promise<Result<{ rows: ClubImportRow[]; tooMany: boolean }>> {
  return run(async () => {
    await mustDirect(deps.pool, viewer);
    const { rows, tooMany } = await previewRows(deps.pool, checkText(text));
    return { rows, tooMany };
  });
}

// Add every new team in one batch (new clubs are made; each Head Coach's login is made if new). Checked again here.
export async function importClubTeams(
  deps: Deps,
  viewer: SessionUser,
  text: unknown,
): Promise<Result<{ added: string[]; skipped: string[] }>> {
  return run(async () => {
    await mustDirect(deps.pool, viewer);
    const t = checkText(text);
    return withTx(deps.pool, async (q) => {
      await q.query("select pg_advisory_xact_lock(hashtext('scenic-club-import'))");
      const { rows, clubs } = await previewRows(q, t);
      const batch = (
        await q.query<{ id: string }>(
          "insert into scenic_team_imports (imported_by, imported_at, teams) values ($1, $2, 0) returning id::text",
          [by(viewer), deps.now()],
        )
      ).rows[0].id;
      const added: string[] = [];
      const skipped: string[] = [];
      for (const [i, r] of rows.entries()) {
        if (r.status !== "new") {
          skipped.push(`${r.name || `Row ${r.line}`}: ${r.status === "exists" ? "already a team" : r.errors.join("; ")}`);
          continue;
        }
        try {
          const club = await clubFor(q, viewer, { name: clubs[i], abbr: "" });
          // With a cell: their login (made if new). Without one yet: the team waits for it, named for them.
          const head = r.coach?.cell ? await resolveHead(q, r.coach, deps.now()) : null;
          if (head && r.coach?.email)
            await q.query("update users set email = $2 where coach_id = $1 and email is null", [head.coachId, r.coach.email]);
          const waiting = r.coach && !r.coach.cell ? { first: r.coach.first, last: r.coach.last } : null;
          const grades = importGrades(r.grade!);
          const name = await clubTeamName(q, club, r.gender!, grades, head?.lastName ?? waiting?.last ?? null);
          await insertTeam(q, viewer, deps.now(), {
            name,
            gender: r.gender!,
            grades,
            level: r.level!,
            club,
            coachId: head?.coachId ?? null,
            alt: r.altName,
            importId: batch,
            waiting,
          });
          added.push(`${name} · ${club.name}`);
        } catch (e) {
          if (!(e instanceof TeamError)) throw e;
          skipped.push(`${r.name}: ${e.message}`);
        }
      }
      if (added.length) await q.query("update scenic_team_imports set teams = $2 where id = $1", [batch, added.length]);
      else await q.query("delete from scenic_team_imports where id = $1", [batch]);
      // As named now: a later team can have numbered an earlier one ("RA 3G Campbell 1").
      const names = await q.query<{ name: string }>(
        "select t.name || ' · ' || p.name as name from scenic_teams t join partners p on p.id = t.partner_id where t.import_id = $1 order by t.id",
        [batch],
      );
      return { added: names.rows.map((x) => x.name), skipped };
    });
  });
}

export type ClubImport = {
  id: string;
  importedBy: string;
  importedAt: Date;
  teams: number;
  left: number;
  undoneBy: string | null;
};

// Recent imports (newest first), for Undo. Directors of Teams only.
export async function listClubImports(deps: Deps, viewer: SessionUser): Promise<ClubImport[] | null> {
  if (!(await orgHasArea(deps.pool, viewer.coachId, ORG, "teams"))) return null;
  const r = await deps.pool.query<ClubImport>(
    `select i.id::text, i.imported_by as "importedBy", i.imported_at as "importedAt", i.teams, i.undone_by as "undoneBy",
            (select count(*)::int from scenic_teams t where t.import_id = i.id) as left
     from scenic_team_imports i order by i.imported_at desc limit 5`,
  );
  return r.rows;
}

// Undo an import: remove its teams still here. A team registered in a program is kept and named (withdraw it first).
// A coach left coaching no Scenic City team loses the Coach role. The clubs it made stay.
export async function undoClubImport(
  deps: Deps,
  viewer: SessionUser,
  importId: unknown,
): Promise<Result<{ removed: string[]; kept: string[] }>> {
  return run(async () => {
    if (!isId(importId)) throw new TeamError("That import no longer exists.");
    await mustDirect(deps.pool, viewer);
    return withTx(deps.pool, async (q) => {
      const i = await q.query<{ undone_by: string | null }>(
        "select undone_by from scenic_team_imports where id = $1 for update",
        [importId],
      );
      if (!i.rows[0]) throw new TeamError("That import no longer exists.");
      if (i.rows[0].undone_by) throw new TeamError(`${i.rows[0].undone_by} already undid it.`);
      const teams = await q.query<{ id: string; name: string; partner: string; coach_id: string | null; registered: boolean }>(
        `select t.id::text, t.name, t.partner_id::text as partner, t.coach_id, exists (select 1 from scenic_registrations r where r.team_id = t.id) as registered
         from scenic_teams t where t.import_id = $1 order by t.gender, t.grade, lower(t.name) for update`,
        [importId],
      );
      const removed: string[] = [];
      const kept: string[] = [];
      for (const t of teams.rows) {
        if (t.registered) {
          kept.push(t.name);
          continue;
        }
        await q.query("delete from scenic_teams where id = $1", [t.id]);
        if (t.coach_id) {
          const still = await q.query("select 1 from scenic_teams where coach_id = $1 limit 1", [t.coach_id]);
          if (!still.rowCount) await q.query("select set_role($1, $2, 'Coach', false, $3)", [t.coach_id, ORG, by(viewer)]);
        }
        removed.push(t.name);
        await settleClubName(q, t.partner, baseName(t.name));
      }
      if (!kept.length)
        await q.query("update scenic_team_imports set undone_by = $2, undone_at = $3 where id = $1", [
          importId,
          by(viewer),
          deps.now(),
        ]);
      return { removed, kept };
    });
  });
}
