// Grade requirements (SPEC.md section 5): the age control date, the oldest age and the age exception, set in a League
// program's gear and in an organization's gear. An organization can adopt its League's requirements (the current
// Scenic City League: not ended yet, the earliest first), which greys its own settings out.
import type { SessionUser } from "./auth/service";
import type { Pool } from "pg";
import type { Queryable } from "./sql";
import { isProgramsDirector } from "./scenic-programs";
import { easternDate } from "./time";
import { DEFAULT_RULES, type GradeRules } from "./eligibility";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };

const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// The saved form of what a Director entered (ages as grade + n), or null when it isn't valid.
export function cleanRules(v: unknown): GradeRules | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (!isInt(r.month, 1, 12) || !isInt(r.day, 1, DAYS[(r.month as number) - 1])) return null;
  if (!isInt(r.oldest, 5, 12)) return null;
  if (r.exception !== null && (!isInt(r.exception, 4, 11) || (r.exception as number) >= (r.oldest as number))) return null;
  return { month: r.month as number, day: r.day as number, oldest: r.oldest as number, exception: r.exception as number | null };
}

const asRules = (v: unknown): GradeRules => cleanRules(v) ?? DEFAULT_RULES;

// The current League (not ended yet; the earliest first): its name and grade requirements.
async function currentLeague(q: Pick<Queryable, "query">, now: Date) {
  const r = await q.query<{ name: string; grade_rules: unknown }>(
    `select name, grade_rules from scenic_programs where kind = 'League' and ends_on >= $1::date
     order by starts_on, id limit 1`,
    [easternDate(now)],
  );
  return r.rows[0] ? { name: r.rows[0].name, rules: asRules(r.rows[0].grade_rules) } : null;
}

export type OrgGradeRules = {
  own: GradeRules; // the organization's own settings (greyed out while adopting)
  adopt: boolean;
  league: { name: string; rules: GradeRules } | null; // the League it would adopt from
  rules: GradeRules; // what its rosters are checked against
  from: string | null; // "Winter (26/27)" when adopted
};

// What an organization's rosters are checked against.
export async function orgGradeRules(q: Pick<Queryable, "query">, org: string, now: Date): Promise<OrgGradeRules> {
  const [o, league] = await Promise.all([
    q.query<{ grade_rules: unknown; adopt_league_grades: boolean }>(
      "select grade_rules, adopt_league_grades from organizations where slug = $1",
      [org],
    ),
    currentLeague(q, now),
  ]);
  const own = asRules(o.rows[0]?.grade_rules);
  const adopt = o.rows[0]?.adopt_league_grades ?? false;
  const use = adopt && league;
  return { own, adopt, league, rules: use ? league.rules : own, from: use ? league.name : null };
}

export async function programGradeRules(q: Pick<Queryable, "query">, programId: string): Promise<GradeRules> {
  const r = await q.query<{ grade_rules: unknown }>("select grade_rules from scenic_programs where id = $1", [programId]);
  return asRules(r.rows[0]?.grade_rules);
}

// An organization's Admins: its own requirements, or adopt its League's.
export async function setOrgGradeRules(
  deps: Deps,
  viewer: SessionUser,
  org: string,
  input: { adopt: unknown; rules: unknown },
): Promise<Result> {
  const rules = cleanRules(input.rules);
  if (!rules) return { ok: false, message: "Check the control date and ages." };
  const admin = await deps.pool.query<{ ok: boolean }>("select acts_as($1, $2, 'Admin') as ok", [viewer.coachId, org]);
  if (!admin.rows[0]?.ok) return { ok: false, message: "Only an Admin of this organization can change its grade requirements." };
  await deps.pool.query(
    `update organizations set grade_rules = $2, adopt_league_grades = $3, grade_rules_by = $4, grade_rules_at = $5
     where slug = $1`,
    [org, JSON.stringify(rules), input.adopt === true, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
  );
  return { ok: true };
}

// Directors of Programs: a League program's requirements.
export async function setProgramGradeRules(deps: Deps, viewer: SessionUser, programId: unknown, input: unknown): Promise<Result> {
  if (typeof programId !== "string" || !/^\d{1,18}$/.test(programId)) return { ok: false, message: "That program no longer exists." };
  const rules = cleanRules(input);
  if (!rules) return { ok: false, message: "Check the control date and ages." };
  if (!(await isProgramsDirector(deps.pool, viewer))) return { ok: false, message: "Only a Director of Programs can do that." };
  const r = await deps.pool.query(
    "update scenic_programs set grade_rules = $2, grade_rules_by = $3, grade_rules_at = $4 where id = $1",
    [programId, JSON.stringify(rules), `${viewer.firstName} ${viewer.lastName}`, deps.now()],
  );
  return r.rowCount ? { ok: true } : { ok: false, message: "That program no longer exists." };
}
