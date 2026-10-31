// Scenic City programs (SPEC.md section 13, build step 6b): League, Circuit and Tournament.
// Directors of Programs (and Admins) create them (dates, registration window, fee) and set them up:
//   Division     = a gender and a group of grades, e.g. Boys K–1st (Boys and Girls stay separate).
//   Grade group  = one grade at one level inside it, e.g. K REC, 2nd COMP (the levels are picked for the division).
//   Pool         = teams inside a grade group (Pool A, Pool B…); Directors add pools and move teams between them.
// While registration is open, whoever manages a team (its partner's contacts, its Solo coach, a Director of Teams)
// registers it; it's in at once, in the smallest pool of the grade group matching its gender, grade and level.
// Directors of Programs mark Paid.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { orgHasArea } from "./org-admin";
import { cleanPlaceName } from "./scenic-partners";
import { LEVELS, gradeLabel, gradeRange, teamsICanManage, type Level } from "./scenic-teams";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
class ProgramError extends Error {}

const ORG = "scenic-city";
export const PROGRAM_KINDS = ["League", "Circuit", "Tournament"] as const;
export type ProgramKind = (typeof PROGRAM_KINDS)[number];
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(`${v}T12:00:00Z`));
const programsOnly = "Only a Scenic City Director of Programs can do that.";

export const isProgramsDirector = (q: Queryable, viewer: SessionUser) => orgHasArea(q, viewer.coachId, ORG, "programs");

async function inScenicCity(q: Queryable, viewer: SessionUser): Promise<boolean> {
  const r = await q.query("select 1 from org_roles where coach_id = $1 and org = 'scenic-city' and role <> 'Request' limit 1", [
    viewer.coachId,
  ]);
  return r.rowCount === 1;
}

async function run<T extends object>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof ProgramError) return { ok: false, message: e.message };
    if ((e as { code?: string }).code === "23505") return { ok: false, message: "There's already a program with that name." };
    throw e;
  }
}

// "Open" while today (Eastern) is within the registration dates.
export type RegStatus = "upcoming" | "open" | "closed";
const regStatus = (today: string, opens: string, closes: string): RegStatus =>
  today < opens ? "upcoming" : today > closes ? "closed" : "open";

// ---- Listing ----

export type ProgramSummary = {
  id: string;
  kind: ProgramKind;
  name: string;
  startsOn: string;
  endsOn: string;
  regOpens: string;
  regCloses: string;
  feeCents: number | null;
  status: RegStatus;
  divisions: number;
  teams: number;
};

const SUMMARY = `select p.id::text, p.kind, p.name, p.starts_on::text as "startsOn", p.ends_on::text as "endsOn",
    p.reg_opens::text as "regOpens", p.reg_closes::text as "regCloses", p.fee_cents as "feeCents",
    (select count(*)::int from scenic_divisions d where d.program_id = p.id) as divisions,
    (select count(*)::int from scenic_registrations r where r.program_id = p.id) as teams
  from scenic_programs p`;

// Everyone in Scenic City sees the programs: soonest first, finished ones last.
export async function listPrograms(
  deps: Deps,
  viewer: SessionUser,
): Promise<{ programs: ProgramSummary[]; canManage: boolean } | null> {
  if (!(await inScenicCity(deps.pool, viewer))) return null;
  const today = easternDate(deps.now());
  const r = await deps.pool.query<Omit<ProgramSummary, "status">>(
    `${SUMMARY} order by (p.ends_on < $1::date), p.starts_on, lower(p.name)`,
    [today],
  );
  return {
    programs: r.rows.map((p) => ({ ...p, status: regStatus(today, p.regOpens, p.regCloses) })),
    canManage: await isProgramsDirector(deps.pool, viewer),
  };
}

const ordinal = (g: number) => gradeLabel(g, g);
const divisionLabel = (d: { gender: string; gradeLow: number; gradeHigh: number }) =>
  `${d.gender} ${gradeRange(d.gradeLow, d.gradeHigh)}`;
const groupLabel = (g: { grade: number; level: string }) => `${ordinal(g.grade)} ${g.level}`;

export type RegisteredTeam = {
  teamId: string;
  name: string;
  gradeLabel: string;
  level: Level;
  from: string; // partner name, or "Solo · owner"
  coach: string;
  coachCell: string;
  registeredBy: string;
  movedBy: string | null;
  paid: boolean;
  paidSetBy: string | null;
  canWithdraw: boolean;
};
export type PoolView = { id: string; name: string; teams: RegisteredTeam[] };
export type GradeGroup = { id: string; grade: number; level: Level; label: string; pools: PoolView[] };
export type DivisionView = {
  id: string;
  gender: "Boys" | "Girls";
  gradeLow: number;
  gradeHigh: number;
  label: string;
  teams: number;
  groups: GradeGroup[];
};

export type ProgramDetail = ProgramSummary & {
  today: string; // Eastern, YYYY-MM-DD
  gameDates: string[]; // the program's game dates, YYYY-MM-DD, soonest first
  createdBy: string;
  updatedBy: string;
  divisionList: DivisionView[];
  canManage: boolean;
  // The viewer's teams that can register now, with where each would go (none while registration is closed).
  canRegister: { teamId: string; name: string; division: string }[];
  // Their teams that can't, and why.
  cantRegister: { name: string; why: string }[];
};

export async function getProgram(deps: Deps, viewer: SessionUser, id: unknown): Promise<ProgramDetail | null> {
  if (!isId(id) || !(await inScenicCity(deps.pool, viewer))) return null;
  const today = easternDate(deps.now());
  const p = await deps.pool.query<Omit<ProgramSummary, "status"> & { createdBy: string; updatedBy: string }>(
    `${SUMMARY.replace("from scenic_programs p", ', p.created_by as "createdBy", p.updated_by as "updatedBy" from scenic_programs p')} where p.id = $1`,
    [id],
  );
  const prog = p.rows[0];
  if (!prog) return null;
  const status = regStatus(today, prog.regOpens, prog.regCloses);
  const [dates, divs, groups, pools, regs, manage, mine] = await Promise.all([
    deps.pool.query<{ day: string }>(
      `select to_char(g.day, 'YYYY-MM-DD') as day from program_game_days pg join game_days g on g.id = pg.game_day_id
       where pg.program_id = $1 order by g.day`,
      [id],
    ),
    deps.pool.query<{ id: string; gender: "Boys" | "Girls"; gradeLow: number; gradeHigh: number }>(
      `select id::text, gender, grade_low as "gradeLow", grade_high as "gradeHigh" from scenic_divisions
       where program_id = $1 order by gender, grade_low`,
      [id],
    ),
    deps.pool.query<{ id: string; divisionId: string; grade: number; level: Level }>(
      `select g.id::text, g.division_id::text as "divisionId", g.grade, g.level from scenic_grade_groups g
       join scenic_divisions d on d.id = g.division_id where d.program_id = $1 order by g.grade, g.level desc`,
      [id],
    ),
    deps.pool.query<{ id: string; groupId: string; name: string }>(
      `select o.id::text, o.group_id::text as "groupId", o.name from scenic_pools o join scenic_grade_groups g on g.id = o.group_id
       join scenic_divisions d on d.id = g.division_id where d.program_id = $1 order by o.name`,
      [id],
    ),
    deps.pool.query<{
      pool_id: string;
      team_id: string;
      name: string;
      grade_low: number;
      grade: number;
      level: Level;
      partner: string | null;
      owner: string | null;
      coach: string;
      coach_cell: string;
      registered_by: string;
      moved_by: string | null;
      paid: boolean;
      paid_set_by: string | null;
    }>(
      `select r.pool_id::text, t.id::text as team_id, t.name, t.grade_low, t.grade, t.level, p.name as partner,
              o.first_name || ' ' || o.last_name as owner, c.first_name || ' ' || c.last_name as coach, c.cell as coach_cell,
              r.registered_by, r.moved_by, r.paid, r.paid_set_by
       from scenic_registrations r join scenic_teams t on t.id = r.team_id join users c on c.coach_id = t.coach_id
       left join partners p on p.id = t.partner_id left join users o on o.coach_id = t.owner_coach_id
       where r.program_id = $1 order by lower(t.name)`,
      [id],
    ),
    isProgramsDirector(deps.pool, viewer),
    teamsICanManage(deps.pool, viewer),
  ]);
  const mineIds = new Set(mine.map((t) => t.id));
  const registered = new Set(regs.rows.map((r) => r.team_id));
  const team = (r: (typeof regs.rows)[number]): RegisteredTeam => ({
    teamId: r.team_id,
    name: r.name,
    gradeLabel: gradeLabel(r.grade_low, r.grade),
    level: r.level,
    from: r.partner ?? `Solo · ${r.owner}`,
    coach: r.coach,
    coachCell: r.coach_cell,
    registeredBy: r.registered_by,
    movedBy: r.moved_by,
    paid: r.paid,
    paidSetBy: r.paid_set_by,
    canWithdraw: manage || (status === "open" && mineIds.has(r.team_id)),
  });
  const divisionList: DivisionView[] = divs.rows.map((d) => {
    const gs = groups.rows
      .filter((g) => g.divisionId === d.id)
      .map((g) => ({
        id: g.id,
        grade: g.grade,
        level: g.level,
        label: groupLabel(g),
        pools: pools.rows
          .filter((o) => o.groupId === g.id)
          .map((o) => ({ id: o.id, name: o.name, teams: regs.rows.filter((r) => r.pool_id === o.id).map(team) })),
      }));
    return {
      ...d,
      label: divisionLabel(d),
      groups: gs,
      teams: gs.flatMap((g) => g.pools).reduce((n, o) => n + o.teams.length, 0),
    };
  });
  const canRegister: ProgramDetail["canRegister"] = [];
  const cantRegister: ProgramDetail["cantRegister"] = [];
  if (status === "open" || manage)
    for (const t of mine) {
      if (registered.has(t.id)) continue;
      const d = divisionList.find((x) => x.gender === t.gender && t.grade >= x.gradeLow && t.grade <= x.gradeHigh);
      const g = d?.groups.find((x) => x.grade === t.grade && x.level === t.level);
      if (d && g)
        canRegister.push({
          teamId: t.id,
          name: `${t.name} (${gradeLabel(t.gradeLow, t.grade)} ${t.level})`,
          division: `${d.label} · ${g.label}`,
        });
      else cantRegister.push({ name: t.name, why: `no ${t.gender} ${ordinal(t.grade)} ${t.level} here` });
    }
  return {
    ...prog,
    status,
    today,
    gameDates: dates.rows.map((r) => r.day),
    divisionList,
    canManage: manage,
    canRegister,
    cantRegister,
  };
}

// ---- Directors of Programs: create, edit, delete ----

export type ProgramInput = {
  kind: unknown;
  name: unknown;
  startsOn: unknown;
  endsOn: unknown;
  regOpens: unknown;
  regCloses: unknown;
  fee: unknown; // dollars, e.g. "150" or "150.00"; blank for none
};

function cleanProgram(input: ProgramInput) {
  const kind = PROGRAM_KINDS.find((k) => k === input.kind);
  if (!kind) throw new ProgramError("Pick League, Circuit or Tournament.");
  const name = cleanPlaceName(input.name);
  if (!name) throw new ProgramError("Enter a program name: letters, numbers and simple punctuation, up to 60 characters.");
  const { startsOn, endsOn, regOpens, regCloses } = input;
  if (!isDate(startsOn) || !isDate(endsOn)) throw new ProgramError("Enter the program's start and end dates.");
  if (endsOn < startsOn) throw new ProgramError("The program ends before it starts.");
  if (!isDate(regOpens) || !isDate(regCloses)) throw new ProgramError("Enter when registration opens and closes.");
  if (regCloses < regOpens) throw new ProgramError("Registration closes before it opens.");
  const feeText = typeof input.fee === "string" ? input.fee.trim().replace(/^\$/, "") : "";
  let feeCents: number | null = null;
  if (feeText) {
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(feeText)) throw new ProgramError("Enter the fee in dollars, like 150 or 150.00.");
    feeCents = Math.round(Number(feeText) * 100);
  }
  return { kind, name, startsOn, endsOn, regOpens, regCloses, feeCents };
}

// New (id null) or edit: the program's details. Divisions are added and removed on their own (below).
export async function saveProgram(
  deps: Deps,
  viewer: SessionUser,
  id: unknown,
  input: ProgramInput,
): Promise<Result<{ id: string }>> {
  if (id !== null && !isId(id)) return { ok: false, message: "That program no longer exists." };
  return run(async () => {
    const f = cleanProgram(input);
    return withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      let pid: string;
      if (id === null) {
        const r = await q.query<{ id: string }>(
          `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, fee_cents, created_by, created_at, updated_by, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9) returning id::text`,
          [f.kind, f.name, f.startsOn, f.endsOn, f.regOpens, f.regCloses, f.feeCents, by(viewer), deps.now()],
        );
        pid = r.rows[0].id;
      } else {
        const r = await q.query(
          `update scenic_programs set kind = $2, name = $3, starts_on = $4, ends_on = $5, reg_opens = $6, reg_closes = $7, fee_cents = $8,
                  updated_by = $9, updated_at = $10 where id = $1`,
          [id, f.kind, f.name, f.startsOn, f.endsOn, f.regOpens, f.regCloses, f.feeCents, by(viewer), deps.now()],
        );
        if (!r.rowCount) throw new ProgramError("That program no longer exists.");
        pid = id;
      }
      return { id: pid };
    });
  });
}

export async function deleteProgram(deps: Deps, viewer: SessionUser, id: unknown): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That program no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      const r = await q.query("delete from scenic_programs where id = $1", [id]);
      if (!r.rowCount) throw new ProgramError("That program no longer exists.");
      return {};
    }),
  );
}

// ---- Game dates (Directors of Programs) ----

// The calendar's changes in one go. Added dates must be in the season and not past; each becomes a Scenic City game day
// (made if new). A removed date leaves the program; it stops being a game day unless another program plays then or
// partners already gave court hours for it (then it stays, and `kept` counts it).
export async function saveProgramDates(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  input: { add: unknown; remove: unknown },
): Promise<Result<{ added: number; removed: number; kept: number }>> {
  if (!isId(programId)) return { ok: false, message: "That program no longer exists." };
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v)] : null);
  const add = list(input.add);
  const remove = list(input.remove);
  if (!add || !remove || !add.every(isDate) || !remove.every(isDate))
    return { ok: false, message: "Those dates don't look right." };
  if (add.length + remove.length > 400) return { ok: false, message: "Too many dates at once." };
  if (!add.length && !remove.length) return { ok: false, message: "Tap the dates to add or remove first." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      const p = await q.query<{ starts: string; ends: string }>(
        "select starts_on::text as starts, ends_on::text as ends from scenic_programs where id = $1 for update",
        [programId],
      );
      if (!p.rows[0]) throw new ProgramError("That program no longer exists.");
      const { starts, ends } = p.rows[0];
      if (add.some((d) => d < starts || d > ends)) throw new ProgramError("Game dates must be within the program's season.");
      const today = easternDate(deps.now());
      if (add.some((d) => d < today) || remove.some((d) => d < today)) throw new ProgramError("Past game dates can't change.");
      await q.query(
        "insert into game_days (day, created_by) select d, $2 from unnest($1::date[]) d on conflict (day) do nothing",
        [add, by(viewer)],
      );
      const a = await q.query(
        `insert into program_game_days (program_id, game_day_id, added_by, added_at)
         select $1, g.id, $3, $4 from game_days g where g.day = any($2::date[]) on conflict do nothing`,
        [programId, add, by(viewer), deps.now()],
      );
      const r = await q.query<{ game_day_id: string }>(
        `delete from program_game_days pg using game_days g
         where pg.program_id = $1 and pg.game_day_id = g.id and g.day = any($2::date[]) returning pg.game_day_id::text`,
        [programId, remove],
      );
      const gone = r.rows.map((x) => x.game_day_id);
      const d = await q.query(
        `delete from game_days g where g.id = any($1::bigint[])
           and not exists (select 1 from program_game_days pg where pg.game_day_id = g.id)
           and not exists (select 1 from court_hours h where h.game_day_id = g.id)`,
        [gone],
      );
      return { added: a.rowCount ?? 0, removed: r.rowCount ?? 0, kept: gone.length - (d.rowCount ?? 0) };
    }),
  );
}

// ---- Divisions, grade groups and pools (Directors of Programs) ----

export type DivisionInput = { gender: unknown; from: unknown; to: unknown; levels: unknown };

// Add a division: a gender, grades from–to (K = 0 … 12) and the levels it offers (COMP, REC). Makes a grade group for each
// grade and level, each with Pool A. Divisions of the same gender can't share a grade.
export async function addDivision(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  input: DivisionInput,
): Promise<Result<{ label: string }>> {
  if (!isId(programId)) return { ok: false, message: "That program no longer exists." };
  const gender = input.gender === "Boys" || input.gender === "Girls" ? input.gender : null;
  const levels = Array.isArray(input.levels) ? LEVELS.filter((l) => (input.levels as unknown[]).includes(l)) : [];
  const grade = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 12 ? (v as number) : null);
  const from = grade(input.from);
  const to = grade(input.to);
  if (!gender) return { ok: false, message: "Pick Boys or Girls." };
  if (from === null || to === null) return { ok: false, message: "Pick the grades." };
  if (to < from) return { ok: false, message: "The last grade is before the first." };
  if (!levels.length) return { ok: false, message: "Pick COMP, REC or both." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      // Lock the program so two Directors can't add overlapping divisions at once.
      if (!(await q.query("select 1 from scenic_programs where id = $1 for update", [programId])).rowCount)
        throw new ProgramError("That program no longer exists.");
      const clash = await q.query<{ gender: string; gradeLow: number; gradeHigh: number }>(
        `select gender, grade_low as "gradeLow", grade_high as "gradeHigh" from scenic_divisions
         where program_id = $1 and gender = $2 and grade_low <= $4 and grade_high >= $3 limit 1`,
        [programId, gender, from, to],
      );
      if (clash.rows[0]) throw new ProgramError(`That overlaps ${divisionLabel(clash.rows[0])}.`);
      const d = await q.query<{ id: string }>(
        "insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, $2, $3, $4) returning id::text",
        [programId, gender, from, to],
      );
      await q.query(
        `with g as (
           insert into scenic_grade_groups (division_id, grade, level)
           select $1, gr, lv from generate_series($2::int, $3::int) gr, unnest($4::text[]) lv returning id)
         insert into scenic_pools (group_id, name) select id, 'Pool A' from g`,
        [d.rows[0].id, from, to, levels],
      );
      return { label: divisionLabel({ gender, gradeLow: from, gradeHigh: to }) };
    }),
  );
}

// Remove a division with no teams in it (its grade groups and pools go with it).
export async function removeDivision(deps: Deps, viewer: SessionUser, divisionId: unknown): Promise<Result> {
  if (!isId(divisionId)) return { ok: false, message: "That division no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      const d = await q.query<{ gender: string; gradeLow: number; gradeHigh: number; teams: number }>(
        `select gender, grade_low as "gradeLow", grade_high as "gradeHigh",
                (select count(*)::int from scenic_registrations r join scenic_pools o on o.id = r.pool_id
                 join scenic_grade_groups g on g.id = o.group_id where g.division_id = d.id) as teams
         from scenic_divisions d where id = $1 for update`,
        [divisionId],
      );
      if (!d.rows[0]) throw new ProgramError("That division no longer exists.");
      if (d.rows[0].teams) throw new ProgramError(`${divisionLabel(d.rows[0])} has teams registered. Withdraw them first.`);
      await q.query("delete from scenic_divisions where id = $1", [divisionId]);
      return {};
    }),
  );
}

// Add the next pool to a grade group (Pool B, Pool C…).
export async function addPool(deps: Deps, viewer: SessionUser, groupId: unknown): Promise<Result<{ name: string }>> {
  if (!isId(groupId)) return { ok: false, message: "That grade group no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      if (!(await q.query("select 1 from scenic_grade_groups where id = $1 for update", [groupId])).rowCount)
        throw new ProgramError("That grade group no longer exists.");
      const names = new Set(
        (await q.query<{ name: string }>("select name from scenic_pools where group_id = $1", [groupId])).rows.map((r) => r.name),
      );
      const letter = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find((l) => !names.has(`Pool ${l}`));
      if (!letter) throw new ProgramError("That's as many pools as a grade group can have.");
      await q.query("insert into scenic_pools (group_id, name) values ($1, $2)", [groupId, `Pool ${letter}`]);
      return { name: `Pool ${letter}` };
    }),
  );
}

// Remove an empty pool (a grade group keeps at least one).
export async function removePool(deps: Deps, viewer: SessionUser, poolId: unknown): Promise<Result> {
  if (!isId(poolId)) return { ok: false, message: "That pool no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      const o = await q.query<{ group_id: string; name: string }>("select group_id::text, name from scenic_pools where id = $1", [
        poolId,
      ]);
      if (!o.rows[0]) throw new ProgramError("That pool no longer exists.");
      await q.query("select 1 from scenic_grade_groups where id = $1 for update", [o.rows[0].group_id]);
      if ((await q.query("select 1 from scenic_registrations where pool_id = $1 limit 1", [poolId])).rowCount)
        throw new ProgramError(`${o.rows[0].name} has teams. Move them first.`);
      const left = await q.query<{ n: number }>("select count(*)::int as n from scenic_pools where group_id = $1", [
        o.rows[0].group_id,
      ]);
      if (left.rows[0].n <= 1) throw new ProgramError("A grade group needs at least one pool.");
      await q.query("delete from scenic_pools where id = $1", [poolId]);
      return {};
    }),
  );
}

// Move a registered team to another pool in its grade group (who moved it is recorded).
export async function moveTeam(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  teamId: unknown,
  poolId: unknown,
): Promise<Result> {
  if (!isId(programId) || !isId(teamId) || !isId(poolId)) return { ok: false, message: "Pick a pool." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      const r = await q.query(
        `update scenic_registrations r set pool_id = $3, moved_by = $4, moved_at = $5
         where r.program_id = $1 and r.team_id = $2 and r.pool_id <> $3
           and (select group_id from scenic_pools where id = $3) = (select group_id from scenic_pools where id = r.pool_id)`,
        [programId, teamId, poolId, by(viewer), deps.now()],
      );
      if (!r.rowCount) throw new ProgramError("Pick another pool in the same grade group.");
      return {};
    }),
  );
}

// ---- Registering teams ----

// The grade group's pool with the fewest teams (first by name on a tie), for a team of this gender, grade and level.
async function poolFor(q: PoolClient, programId: string, t: { gender: string; grade: number; level: string }) {
  const r = await q.query<{ id: string; name: string; gender: string; gradeLow: number; gradeHigh: number }>(
    `select o.id::text, o.name, d.gender, d.grade_low as "gradeLow", d.grade_high as "gradeHigh"
     from scenic_divisions d join scenic_grade_groups g on g.division_id = d.id join scenic_pools o on o.group_id = g.id
     where d.program_id = $1 and d.gender = $2 and g.grade = $3 and g.level = $4
     order by (select count(*) from scenic_registrations r where r.pool_id = o.id), o.name limit 1`,
    [programId, t.gender, t.grade, t.level],
  );
  return r.rows[0] ?? null;
}

// Whoever manages the team, while registration is open (a Director of Programs any time). In at once.
export async function registerTeam(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  teamId: unknown,
): Promise<Result<{ division: string }>> {
  if (!isId(programId) || !isId(teamId)) return { ok: false, message: "Pick a team." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const p = await q.query<{ reg_opens: string; reg_closes: string }>(
        "select reg_opens::text, reg_closes::text from scenic_programs where id = $1 for update",
        [programId],
      );
      if (!p.rows[0]) throw new ProgramError("That program no longer exists.");
      const manage = await isProgramsDirector(q, viewer);
      if (!manage && regStatus(easternDate(deps.now()), p.rows[0].reg_opens, p.rows[0].reg_closes) !== "open")
        throw new ProgramError("Registration isn't open for this program.");
      if (!manage && !(await teamsICanManage(q, viewer)).some((x) => x.id === teamId))
        throw new ProgramError("You can only register teams you manage.");
      const team = (
        await q.query<{ gender: string; grade: number; level: string; name: string }>(
          "select gender, grade, level, name from scenic_teams where id = $1 for share",
          [teamId],
        )
      ).rows[0];
      if (!team) throw new ProgramError("That team no longer exists.");
      const pool = await poolFor(q, programId, team);
      if (!pool) throw new ProgramError(`This program has no ${team.gender} ${ordinal(team.grade)} ${team.level}.`);
      const ins = await q.query(
        `insert into scenic_registrations (program_id, team_id, pool_id, registered_by, registered_at)
         values ($1, $2, $3, $4, $5) on conflict do nothing`,
        [programId, teamId, pool.id, by(viewer), deps.now()],
      );
      if (!ins.rowCount) throw new ProgramError(`${team.name} is already registered.`);
      return { division: `${divisionLabel(pool)} · ${groupLabel(team)} · ${pool.name}` };
    }),
  );
}

// Take a team out: whoever manages it while registration is open, or a Director of Programs any time.
export async function withdrawTeam(deps: Deps, viewer: SessionUser, programId: unknown, teamId: unknown): Promise<Result> {
  if (!isId(programId) || !isId(teamId)) return { ok: false, message: "Pick a team." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      const p = await q.query<{ reg_opens: string; reg_closes: string }>(
        "select reg_opens::text, reg_closes::text from scenic_programs where id = $1 for share",
        [programId],
      );
      if (!p.rows[0]) throw new ProgramError("That program no longer exists.");
      if (!(await isProgramsDirector(q, viewer))) {
        if (regStatus(easternDate(deps.now()), p.rows[0].reg_opens, p.rows[0].reg_closes) !== "open")
          throw new ProgramError("Registration is closed. Ask a Director of Programs.");
        if (!(await teamsICanManage(q, viewer)).some((x) => x.id === teamId))
          throw new ProgramError("You can only withdraw teams you manage.");
      }
      const r = await q.query("delete from scenic_registrations where program_id = $1 and team_id = $2", [programId, teamId]);
      if (!r.rowCount) throw new ProgramError("That team isn't registered.");
      return {};
    }),
  );
}

// Directors of Programs: mark a registration Paid or Unpaid (who and when are recorded).
export async function setPaid(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  teamId: unknown,
  paid: boolean,
): Promise<Result> {
  if (!isId(programId) || !isId(teamId)) return { ok: false, message: "Pick a team." };
  if (!(await isProgramsDirector(deps.pool, viewer))) return { ok: false, message: programsOnly };
  const r = await deps.pool.query(
    "update scenic_registrations set paid = $3, paid_set_by = $4, paid_set_at = $5 where program_id = $1 and team_id = $2",
    [programId, teamId, paid === true, by(viewer), deps.now()],
  );
  return r.rowCount ? { ok: true } : { ok: false, message: "That team isn't registered." };
}
