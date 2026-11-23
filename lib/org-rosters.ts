// Rosters for a registered organization's teams (SPEC.md section 14). Its Admins and Directors of Teams add players
// (first, last, grade, birthdate, optional jersey number) one at a time or many at once (pasted or a CSV, with a preview
// first), and remove them; the team's coaches see the roster. Names and numbers are unique on a team. A player without a
// birthdate is warned about (and it can be filled in on the roster).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanName } from "./auth/validate";
import { canManageTeams, teamsManagerOf } from "./org-teams";
import { hasFeature } from "./features";
import { withTx, type Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const managersOnly = { ok: false as const, message: "Only an Admin or Director of Teams, or the team's Head or Assistant Coach, can change its roster." };

export type OrgPlayer = {
  id: string;
  first: string;
  last: string;
  grade: number;
  jersey: string | null;
  birthdate: string | null; // YYYY-MM-DD
  birthdateBy: string | null;
  addedBy: string;
};

// "2014-05-03", "5/3/2014" or "05-03-2014" → "2014-05-03" (a real date, a year from 1990 on); "" → null; else undefined.
export function birthdateOf(v: unknown): string | null | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
  else return undefined;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d || y < 1990 || y > 2035) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// "3", "3rd", "K", "Kindergarten" → 0 … 12.
export function gradeOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v <= 12 ? v : null;
  if (typeof v !== "string") return null;
  const s = v
    .toLowerCase()
    .replace(/grade/g, "")
    .trim()
    .replace(/(st|nd|rd|th)$/, "")
    .trim();
  if (s === "k" || s === "kindergarten") return 0;
  return /^\d{1,2}$/.test(s) && Number(s) <= 12 ? Number(s) : null;
}
const jerseyOf = (v: unknown) => {
  const s = typeof v === "string" ? v.trim().replace(/^#/, "") : typeof v === "number" ? String(v) : "";
  return s === ""
    ? { ok: true as const, jersey: null }
    : /^\d{1,2}$/.test(s)
      ? { ok: true as const, jersey: s }
      : { ok: false as const };
};

// The team, if this person may see its roster: its organization's Admins and Directors of Teams, or its coaches.
// Who enters it (SPEC.md section 14): with CourtPlayers the roster comes from player registrations, set by its
// Directors; without it (CourtTeams, CourtClub) the organization's Admins and Directors of Teams or the team's Head and
// Assistant Coaches type or import it.
async function teamFor(q: Pick<Queryable, "query">, viewer: SessionUser, org: string, teamId: string) {
  const t = await q.query("select 1 from org_teams where id = $1 and org = $2", [teamId, org]);
  if (!t.rowCount) return null;
  if (await canManageTeams(q, viewer, org)) return { manage: true };
  const c = await q.query<{ role: string }>("select role from org_team_coaches where team_id = $1 and coach_id = $2", [teamId, viewer.coachId]);
  if (!c.rowCount) return null;
  const coach = c.rows.some((r) => r.role === "HeadCoach" || r.role === "AsstCoach");
  return { manage: coach && !(await hasFeature(q, org, "player-registration")) };
}

export async function listOrgRoster(
  deps: Deps,
  viewer: SessionUser,
  org: string,
  teamId: string,
): Promise<{ players: OrgPlayer[]; canManage: boolean } | null> {
  if (!isId(teamId)) return null;
  const t = await teamFor(deps.pool, viewer, org, teamId);
  if (!t) return null;
  const r = await deps.pool.query<OrgPlayer>(
    `select id::text, first_name as first, last_name as last, grade, jersey, to_char(birthdate, 'YYYY-MM-DD') as birthdate,
            birthdate_by as "birthdateBy", added_by as "addedBy"
     from org_team_players where team_id = $1
     order by jersey::int nulls last, lower(last_name), lower(first_name)`, // by jersey number (none last), then name
    [teamId],
  );
  return { players: r.rows, canManage: t.manage };
}

// The organization, when this person may change this team's roster (see teamFor).
async function rosterOrg(q: Pick<Queryable, "query">, viewer: SessionUser, org: unknown, teamId: unknown): Promise<string | null> {
  const o = await teamsManagerOf(q, viewer, org);
  if (o) return o;
  if (typeof org !== "string" || !isId(teamId)) return null;
  return (await teamFor(q, viewer, org, teamId))?.manage ? org : null;
}

export type PlayerInput = { first: unknown; last: unknown; grade: unknown; jersey?: unknown; birthdate?: unknown };

function cleanPlayer(p: PlayerInput): { first: string; last: string; grade: number; jersey: string | null; birthdate: string | null } | string {
  const first = cleanName(p.first);
  const last = cleanName(p.last);
  if (!first || !last) return "First and last name (letters only)";
  const grade = gradeOf(p.grade);
  if (grade === null) return "Grade: K to 12";
  const j = jerseyOf(p.jersey);
  if (!j.ok) return "Jersey: a number up to 99";
  const birthdate = birthdateOf(p.birthdate);
  if (birthdate === undefined) return "Birthdate: a date like 5/3/2014";
  return { first, last, grade, jersey: j.jersey, birthdate };
}

// Adds players to a team, skipping (and naming) any already on it or whose jersey number is taken. In one transaction.
async function addPlayers(deps: Deps, viewer: SessionUser, org: unknown, teamId: unknown, list: PlayerInput[]) {
  const o = await rosterOrg(deps.pool, viewer, org, teamId);
  if (!o) return managersOnly;
  if (!isId(teamId)) return { ok: false as const, message: "That team no longer exists." };
  return withTx(deps.pool, async (q) => {
    const t = await q.query("select 1 from org_teams where id = $1 and org = $2 for update", [teamId, o]);
    if (!t.rowCount) return { ok: false as const, message: "That team no longer exists." };
    const added: string[] = [];
    const skipped: string[] = [];
    for (const raw of list) {
      const p = cleanPlayer(raw);
      if (typeof p === "string") {
        skipped.push(`${String(raw.first ?? "")} ${String(raw.last ?? "")}`.trim() + `: ${p}`);
        continue;
      }
      if (p.jersey) {
        const taken = await q.query("select 1 from org_team_players where team_id = $1 and jersey = $2", [teamId, p.jersey]);
        if (taken.rowCount) {
          skipped.push(`${p.first} ${p.last}: #${p.jersey} is taken`);
          continue;
        }
      }
      const ins = await q.query(
        `insert into org_team_players (team_id, first_name, last_name, grade, jersey, added_by, added_at, birthdate, birthdate_by, birthdate_at)
         values ($1, $2, $3, $4, $5, $6::text, $7::timestamptz, $8::date, case when $8::date is null then null else $6::text end,
                 case when $8::date is null then null else $7::timestamptz end)
         on conflict do nothing`,
        [teamId, p.first, p.last, p.grade, p.jersey, by(viewer), deps.now(), p.birthdate],
      );
      if (ins.rowCount) added.push(`${p.first} ${p.last}`);
      else skipped.push(`${p.first} ${p.last}: already on the team`);
    }
    return { ok: true as const, added, skipped };
  });
}

export async function addOrgPlayer(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  teamId: unknown,
  p: PlayerInput,
): Promise<Result<{ added: string[]; skipped: string[] }>> {
  const r = await addPlayers(deps, viewer, org, teamId, [p]);
  if (r.ok && r.skipped.length) return { ok: false, message: r.skipped[0].replace(/^[^:]*: /, "") };
  return r;
}

// Fill in (or fix) a player's birthdate on the roster; who set it is recorded.
export async function setOrgPlayerBirthdate(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  teamId: unknown,
  playerId: unknown,
  birthdate: unknown,
): Promise<Result> {
  const o = await rosterOrg(deps.pool, viewer, org, teamId);
  if (!o) return managersOnly;
  if (!isId(teamId) || !isId(playerId)) return { ok: false, message: "That player isn't on this team." };
  const b = birthdateOf(birthdate);
  if (!b) return { ok: false, message: "Enter a birthdate like 5/3/2014." };
  const r = await deps.pool.query(
    `update org_team_players p set birthdate = $4, birthdate_by = $5, birthdate_at = $6 from org_teams t
      where p.id = $1 and p.team_id = t.id and t.id = $2 and t.org = $3`,
    [playerId, teamId, o, b, by(viewer), deps.now()],
  );
  return r.rowCount ? { ok: true } : { ok: false, message: "That player isn't on this team." };
}

export async function removeOrgPlayer(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  teamId: unknown,
  playerId: unknown,
): Promise<Result> {
  const o = await rosterOrg(deps.pool, viewer, org, teamId);
  if (!o) return managersOnly;
  if (!isId(teamId) || !isId(playerId)) return { ok: false, message: "That player isn't on this team." };
  const r = await deps.pool.query(
    `delete from org_team_players p using org_teams t where p.id = $1 and p.team_id = t.id and t.id = $2 and t.org = $3`,
    [playerId, teamId, o],
  );
  return r.rowCount ? { ok: true } : { ok: false, message: "That player isn't on this team." };
}

// ---- Many at once: First, Last, Grade, Jersey (optional), Birthdate, one player per row ----

export type PlayerImportRow = { line: number; first: string; last: string; grade: string; jersey: string; birthdate: string; errors: string[] };

function fields(line: string): string[] {
  const sep = line.includes("\t") ? "\t" : ",";
  return line.split(sep).map((f) => f.trim().replace(/^"(.*)"$/, "$1"));
}

export function parsePlayerRows(text: string): PlayerImportRow[] {
  const rows: PlayerImportRow[] = [];
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((raw, i) => {
      if (!raw.trim()) return;
      const [first = "", last = "", grade = "", jersey = "", birthdate = ""] = fields(raw);
      if (!rows.length && /^first/i.test(first) && /last/i.test(last)) return; // a header row
      const p = cleanPlayer({ first, last, grade, jersey, birthdate });
      rows.push({ line: i + 1, first, last, grade, jersey, birthdate, errors: typeof p === "string" ? [p] : [] });
    });
  return rows.slice(0, 100);
}

export async function previewPlayerImport(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  teamId: unknown,
  text: unknown,
): Promise<Result<{ rows: (PlayerImportRow & { status: "new" | "exists" | "error" })[] }>> {
  const o = await rosterOrg(deps.pool, viewer, org, teamId);
  if (!o) return managersOnly;
  if (!isId(teamId) || typeof text !== "string" || !text.trim() || text.length > 50_000)
    return { ok: false, message: "Paste your players or choose a CSV file." };
  const have = new Set(
    (
      await deps.pool.query<{ k: string }>(
        `select lower(p.first_name) || ' ' || lower(p.last_name) as k from org_team_players p join org_teams t on t.id = p.team_id
         where t.id = $1 and t.org = $2`,
        [teamId, o],
      )
    ).rows.map((r) => r.k),
  );
  const seen = new Set<string>();
  return {
    ok: true,
    rows: parsePlayerRows(text).map((r) => {
      const k = `${r.first.toLowerCase()} ${r.last.toLowerCase()}`;
      const errors = [...r.errors, ...(seen.has(k) ? ["Listed twice"] : [])];
      seen.add(k);
      return { ...r, errors, status: errors.length ? "error" : have.has(k) ? "exists" : "new" };
    }),
  };
}

export async function importOrgPlayers(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  teamId: unknown,
  text: unknown,
): Promise<Result<{ added: string[]; skipped: string[] }>> {
  if (typeof text !== "string" || text.length > 50_000) return { ok: false, message: "Paste your players or choose a CSV file." };
  return addPlayers(deps, viewer, org, teamId, parsePlayerRows(text));
}
