// CourtSync officials (SPEC.md section 14, step 4c): the referees a CourtSync Scheduler (e.g. Scenic City) keeps for its
// games. Its Admins and Directors of Officials add them (found by cell, or a login made) and remove them. Assigning them
// to games comes next (4c-2).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanEmail, cleanName } from "./auth/validate";
import { cleanOfficialLevel, parseOfficials, type ParsedOfficial } from "./official-import-parse";
import { hasFeature } from "./features";
import { orgHasArea } from "./org-admin";
import { isOrgSlug, type OrgSlug } from "./orgs";
import { normalizeCell } from "./phone";
import { withTx, type Queryable } from "./sql";
import { matchOrCreateUser } from "./user-match";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type Official = {
  id: string; // their User ID: the last 7 digits of their cell
  name: string;
  cell: string;
  email: string | null;
  level: OfficialLevel | null; // Recruits can't be scheduled to officiate games
  appliedAt: Date | null; // applied online (Apply to officiate)
  application: string | null; // what they wrote then
  addedBy: string;
  addedAt: Date;
};

// An official's Level: one of four. Recruits can't be scheduled to officiate games.
import type { OfficialLevel } from "./official-levels";
export { OFFICIAL_LEVELS, canOfficiate, type OfficialLevel } from "./official-levels";

// The Level picked or typed, any common way ("certified", "exp", "Experience"); "" is no level; null when it isn't one.
export function cleanLevel(v: unknown): OfficialLevel | null | "" {
  const s = String(v ?? "").trim();
  return s ? cleanOfficialLevel(s, true) : "";
}
const BAD_LEVEL = "Level: Certified, Experienced, Student or Recruit.";

const NOT_ALLOWED = "Only an Admin or Director of Officials can manage officials.";

// Does this person keep the organization's officials (it has CourtSync's Scheduler side)?
export async function managesOfficials(q: Pick<Queryable, "query">, viewer: SessionUser, org: unknown): Promise<boolean> {
  if (!isOrgSlug(org) || !(await hasFeature(q, org, "officials"))) return false;
  return orgHasArea(q, viewer.coachId, org, "officials");
}

// The organization's officials, by last name; null for anyone who doesn't keep them.
export async function listOfficials(deps: Pick<Deps, "pool">, viewer: SessionUser, org: OrgSlug): Promise<Official[] | null> {
  if (!(await managesOfficials(deps.pool, viewer, org))) return null;
  const r = await deps.pool.query<Official>(
    `select u.coach_id as id, u.first_name || ' ' || u.last_name as name, u.cell, u.email, o.level, o.applied_at as "appliedAt", o.application,
            o.added_by as "addedBy", o.added_at as "addedAt"
       from org_officials o join users u on u.coach_id = o.coach_id
      where o.org = $1 and u.active
      order by lower(u.last_name), lower(u.first_name)`,
    [org],
  );
  return r.rows;
}

// Add an official by name and cell: the person with that cell, or a new login for them.
export async function addOfficial(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  input: { first: unknown; last: unknown; cell: unknown; email?: unknown; level?: unknown },
): Promise<Result<{ name: string; newLogin: boolean }>> {
  if (!(await managesOfficials(deps.pool, viewer, org))) return { ok: false, message: NOT_ALLOWED };
  const first = cleanName(input.first);
  const last = cleanName(input.last);
  const cell = typeof input.cell === "string" ? normalizeCell(input.cell) : null;
  if (!first || !last) return { ok: false, message: "Enter a first and last name (letters only)." };
  if (!cell) return { ok: false, message: "Enter a 10-digit cell number." };
  const email = String(input.email ?? "").trim() ? cleanEmail(input.email) : null;
  if (String(input.email ?? "").trim() && !email) return { ok: false, message: "That email doesn't look right." };
  const level = cleanLevel(input.level);
  if (level === null) return { ok: false, message: BAD_LEVEL };
  return withTx(deps.pool, async (q) => {
    const m = await matchOrCreateUser(q, { first, last, cell, email }, deps.now());
    if ("error" in m) return { ok: false as const, message: m.error };
    if (email) await q.query("update users set email = $2 where coach_id = $1 and email is null", [m.coachId, email]);
    const r = await q.query(
      "insert into org_officials (org, coach_id, level, added_by, added_at) values ($1, $2, $3, $4, $5) on conflict do nothing",
      [org, m.coachId, level || null, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
    );
    if (!r.rowCount) return { ok: false as const, message: `${m.who} is already one of your officials.` };
    return { ok: true as const, name: m.who, newLogin: m.newLogin };
  });
}

// Set or clear (blank) an official's Level.
export async function setOfficialLevel(
  deps: Pick<Deps, "pool">,
  viewer: SessionUser,
  org: unknown,
  coachId: unknown,
  level: unknown,
): Promise<Result> {
  if (!(await managesOfficials(deps.pool, viewer, org))) return { ok: false, message: NOT_ALLOWED };
  const l = cleanLevel(level);
  if (l === null) return { ok: false, message: BAD_LEVEL };
  if (typeof coachId !== "string" || !/^\d{7}$/.test(coachId)) return { ok: false, message: "That official isn't on your list." };
  const r = await deps.pool.query("update org_officials set level = $3 where org = $1 and coach_id = $2", [org, coachId, l || null]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That official isn't on your list." };
}

// Take someone off the officials list (their login stays).
export async function removeOfficial(deps: Pick<Deps, "pool">, viewer: SessionUser, org: unknown, coachId: unknown): Promise<Result> {
  if (!(await managesOfficials(deps.pool, viewer, org))) return { ok: false, message: NOT_ALLOWED };
  if (typeof coachId !== "string" || !/^\d{7}$/.test(coachId)) return { ok: false, message: "That official isn't on your list." };
  const r = await deps.pool.query("delete from org_officials where org = $1 and coach_id = $2", [org, coachId]);
  return r.rowCount ? { ok: true } : { ok: false, message: "That official isn't on your list." };
}

// Import officials (SPEC.md section 14, step 4c), read like the teams import (lib/official-import-parse.ts): columns
// matched by heading or by what's in them, values cleaned up. Someone with that cell is added as is; anyone else gets a
// login (the email kept on it; blank is fine, they add it at first login). One already on the list with a different
// Level given gets it (Update level).
export type OfficialImportRow = ParsedOfficial & { status: "new" | "update" | "exists" | "error" };

async function checkImport(
  q: Pick<Queryable, "query">,
  org: string,
  text: unknown,
): Promise<Result<{ rows: OfficialImportRow[]; tooMany: boolean }>> {
  if (typeof text !== "string" || !text.trim() || text.length > 200_000)
    return { ok: false, message: "Paste your officials or choose a CSV file." };
  const { rows, tooMany } = parseOfficials(text);
  if (!rows.length) return { ok: false, message: "No officials found. One per row: First, Last, Cell, Email, Level." };
  const have = new Map(
    (
      await q.query<{ cell: string; level: string | null }>(
        "select u.cell, o.level from org_officials o join users u on u.coach_id = o.coach_id where o.org = $1",
        [org],
      )
    ).rows.map((r) => [r.cell, r.level]),
  );
  const seen = new Set<string>();
  return {
    ok: true,
    tooMany,
    rows: rows.map((r) => {
      const errors = [...r.errors, ...(r.cell && seen.has(r.cell) ? ["Listed twice"] : [])];
      if (r.cell) seen.add(r.cell);
      const status = errors.length
        ? "error"
        : have.has(r.cell!)
          ? r.level && have.get(r.cell!) !== r.level
            ? "update"
            : "exists"
          : "new";
      return { ...r, errors, status };
    }),
  };
}

// What an import would do, row by row: New, Already an official, or what to fix.
export async function previewOfficialImport(
  deps: Pick<Deps, "pool">,
  viewer: SessionUser,
  org: unknown,
  text: unknown,
): Promise<Result<{ rows: OfficialImportRow[]; tooMany: boolean }>> {
  if (!(await managesOfficials(deps.pool, viewer, org))) return { ok: false, message: NOT_ALLOWED };
  return checkImport(deps.pool, org as string, text);
}

// Add the new ones (rows to fix and those already on the list are skipped), all together.
export async function importOfficials(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  text: unknown,
): Promise<Result<{ added: number; newLogins: number; updated: number; skipped: number }>> {
  if (!(await managesOfficials(deps.pool, viewer, org))) return { ok: false, message: NOT_ALLOWED };
  return withTx(deps.pool, async (q) => {
    const checked = await checkImport(q, org as string, text);
    if (!checked.ok) return checked;
    let added = 0;
    let newLogins = 0;
    let skipped = 0;
    let updated = 0;
    for (const r of checked.rows) {
      if (r.status === "update") {
        await q.query(
          "update org_officials o set level = $3 from users u where u.coach_id = o.coach_id and o.org = $1 and u.cell = $2",
          [org, r.cell, r.level],
        );
        updated++;
        continue;
      }
      if (r.status !== "new") {
        skipped++;
        continue;
      }
      const m = await matchOrCreateUser(q, { first: r.first, last: r.last, cell: r.cell!, email: r.email }, deps.now());
      if ("error" in m) {
        skipped++;
        continue;
      }
      if (r.email) await q.query("update users set email = $2 where coach_id = $1 and email is null", [m.coachId, r.email]);
      const ins = await q.query(
        "insert into org_officials (org, coach_id, level, added_by, added_at) values ($1, $2, $3, $4, $5) on conflict do nothing",
        [org, m.coachId, r.level, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
      );
      if (ins.rowCount) {
        added++;
        if (m.newLogin) newLogins++;
      } else skipped++;
    }
    return { ok: true as const, added, newLogins, updated, skipped };
  });
}

// ---- Recruits applying online ----

// Is Accept recruits on (Apply to officiate shows on the login page)?
export async function acceptsRecruits(q: Pick<Queryable, "query">, org: string): Promise<boolean> {
  const r = await q.query<{ on: boolean }>("select accepts_recruits as on from organizations where slug = $1", [org]);
  return !!r.rows[0]?.on;
}

// Turn Accept recruits on or off (those who keep the officials).
export async function setAcceptsRecruits(deps: Pick<Deps, "pool">, viewer: SessionUser, org: unknown, on: unknown): Promise<Result> {
  if (!(await managesOfficials(deps.pool, viewer, org))) return { ok: false, message: NOT_ALLOWED };
  await deps.pool.query("update organizations set accepts_recruits = $2 where slug = $1", [org, on === true]);
  return { ok: true };
}

// The organizations taking applications on this login page: itself (with CourtOfficials and Accept recruits on), and
// the Officials Groups approved to officiate its games (Accept recruits on).
export async function recruitingOn(q: Pick<Queryable, "query">, loginOrg: string): Promise<{ org: OrgSlug; name: string }[]> {
  const r = await q.query<{ org: OrgSlug; name: string }>(
    `select o.slug as org, o.name from organizations o
      where o.accepts_recruits
        and (o.slug = $1 or (o.kind = 'Officials' and exists (select 1 from officiating_partnerships p
                                                              where p.officials_org = o.slug and p.for_org = $1 and p.status = 'approved')))
      order by o.slug <> $1, lower(o.name)`,
    [loginOrg],
  );
  const out: { org: OrgSlug; name: string }[] = [];
  for (const x of r.rows) if (await hasFeature(q, x.org, "officials")) out.push(x);
  return out;
}

const APPLICATIONS_PER_HOUR = 30; // per organization, against floods

// Apply to officiate (no login): first, last, cell, email (optional) and their experience (optional). They join the
// organization's officials as a Recruit (a login made for a new cell), noted Applied online.
export async function applyToOfficiate(
  deps: Deps,
  org: unknown,
  input: { first: unknown; last: unknown; cell: unknown; email?: unknown; experience?: unknown; website?: unknown },
): Promise<Result<{ name: string; already: boolean }>> {
  if (!isOrgSlug(org) || !(await acceptsRecruits(deps.pool, org)) || !(await hasFeature(deps.pool, org, "officials")))
    return { ok: false, message: "This organization isn't taking applications right now." };
  if (String(input.website ?? "")) return { ok: false, message: "Something went wrong. Please try again." }; // a bot filled the hidden field
  const first = cleanName(input.first);
  const last = cleanName(input.last);
  const cell = typeof input.cell === "string" ? normalizeCell(input.cell) : null;
  if (!first || !last) return { ok: false, message: "Enter your first and last name (letters only)." };
  if (!cell) return { ok: false, message: "Enter your 10-digit cell number." };
  const email = String(input.email ?? "").trim() ? cleanEmail(input.email) : null;
  if (String(input.email ?? "").trim() && !email) return { ok: false, message: "That email doesn't look right (or leave it blank)." };
  const experience = String(input.experience ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('apply:' || $1))", [org]);
    const recent = await q.query<{ n: number }>(
      "select count(*)::int as n from org_officials where org = $1 and applied_at > $2",
      [org, new Date(deps.now().getTime() - 3_600_000)],
    );
    if (recent.rows[0].n >= APPLICATIONS_PER_HOUR) return { ok: false as const, message: "Lots of applications right now. Please try again in an hour." };
    const m = await matchOrCreateUser(q, { first, last, cell, email }, deps.now());
    if ("error" in m) return { ok: false as const, message: "We couldn't take that cell number. Please contact the organization." };
    if (email) await q.query("update users set email = $2 where coach_id = $1 and email is null", [m.coachId, email]);
    const r = await q.query(
      `insert into org_officials (org, coach_id, level, added_by, added_at, applied_at, application)
       values ($1, $2, 'Recruit', 'Applied online', $3, $3, $4) on conflict do nothing`,
      [org, m.coachId, deps.now(), experience],
    );
    return { ok: true as const, name: first, already: !r.rowCount };
  });
}
