// Player programs (CourtPlayers; SPEC.md section 14, step 2c): a Season players register for. Its Owners, Admins and
// Directors of Events add and change them: name, registration dates, payment dates, and season dates typed in or taken
// from a team program (a League, Circuit or Tournament its teams play in).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { orgHasArea } from "./org-admin";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type PlayerProgramInput = {
  name: unknown;
  regOpens: unknown;
  regCloses: unknown; // "" = open until the season ends
  payOpens: unknown;
  payCloses: unknown;
  seasonFrom: unknown; // a team program's id, or "" to type the dates
  startsOn: unknown;
  endsOn: unknown;
  kind?: unknown; // "Season" (default), "Session" (a Training Session) or "Course" (a Training Course)
  scrimmages?: unknown; // a Season: has scrimmages
  sessions?: unknown; // a Training Course: how many sessions
  tryouts?: unknown; // a Season: has Tryouts sessions
  openGyms?: unknown; // a Season: has Open Gym sessions
  grades?: unknown; // its grades, "K"…"12" (both genders, when the per-gender lists aren't given)
  levels?: unknown; // no longer used: levels of play are a team's setting
  genders?: unknown; // "Boys", "Girls"
  boysGrades?: unknown; // the grades for each gender it has
  girlsGrades?: unknown;
  // Its fee levels (the Fees card; 1 to 10): each its fee in dollars ("" for none) and the grades of each gender it's
  // for. When given, the program's genders and grades are all its levels together.
  feeLevels?: unknown;
  tryoutRegOpens?: unknown; // a Season with Tryouts: when players can sign up for them
  tryoutRegCloses?: unknown;
};
export type PlayerProgramFields = {
  id: string;
  name: string;
  regOpens: string;
  regCloses: string;
  payOpens: string;
  payCloses: string;
  seasonFrom: string;
  startsOn: string;
  endsOn: string;
  kind: ProgramKind;
  tryouts: boolean;
  openGyms: boolean;
  grades: string[];
  levels: string[];
  genders: string[];
  boysGrades: string[];
  girlsGrades: string[];
  feeLevels: FeeLevel[];
  scrimmages: boolean;
  sessions: string;
  tryoutRegOpens: string;
  tryoutRegCloses: string;
};

export { PROGRAM_GENDERS, PROGRAM_GRADES, PROGRAM_KINDS, PROGRAM_LEVELS, isTraining, sessionTypesFor, type ProgramKind, type ProgramSettings } from "./program-kinds";
import type { ProgramKind, ProgramSettings } from "./program-kinds";
import { PROGRAM_GENDERS, PROGRAM_GRADES, PROGRAM_LEVELS } from "./program-kinds";

// A program's type and settings (null when it isn't one of this organization's).
export async function programSettings(q: Pick<Queryable, "query">, programId: string, org?: string): Promise<ProgramSettings | null> {
  if (!isId(programId)) return null;
  const r = await q.query<ProgramSettings>(
    `select kind, tryouts, open_gyms as "openGyms", scrimmages, sessions, grades, levels, genders, boys_grades as "boysGrades", girls_grades as "girlsGrades" from player_programs where id = $1 and ($2::text is null or org = $2)`,
    [programId, org ?? null],
  );
  return r.rows[0] ?? null;
}

export type FeeLevel = { name: string; fee: string; endsOn?: string; boysGrades: string[]; girlsGrades: string[] }; // fee in dollars, "" for none; endsOn "" = the program's end

// Fees from the form: 1 to 10, each with a name, a price (dollars, or none) and at least one grade (the same grade may
// be in several fees: Local, Regional, National). A message when something's wrong.
function cleanFeeLevels(v: unknown): { name: string; fee: number | null; endsOn: string | null; boys: string[]; girls: string[] }[] | string {
  if (!Array.isArray(v) || v.length < 1 || v.length > 10) return "Give 1 to 10 fee levels.";
  const out: { name: string; fee: number | null; endsOn: string | null; boys: string[]; girls: string[] }[] = [];
  for (const [i, x] of v.entries()) {
    const raw = typeof x?.fee === "string" ? x.fee.trim().replace(/^\$/, "") : typeof x?.fee === "number" ? String(x.fee) : "";
    if (raw && !/^\d{1,6}(\.\d{1,2})?$/.test(raw)) return `Fee level ${i + 1}: enter the fee in dollars, like 150 or 150.00.`;
    // Its name (Early Bird, Middle School…): letters and numbers, never starting like a formula; "Fee n" when blank.
    const name = typeof x?.name === "string" ? x.name.replace(/\s+/g, " ").trim() : "";
    if (name.length > 40 || /^[=+\-@]/.test(name)) return `Fee ${i + 1}: a name of up to 40 letters and numbers.`;
    // Its season end date (blank = the program's).
    const endsOn = typeof x?.endsOn === "string" && x.endsOn.trim() ? x.endsOn.trim() : null;
    if (endsOn && !isDate(endsOn)) return `Fee ${i + 1}: check its season end date.`;
    const boys = pickList(x?.boysGrades, PROGRAM_GRADES);
    const girls = pickList(x?.girlsGrades, PROGRAM_GRADES);
    if (!boys.length && !girls.length) return `Fee level ${i + 1}: pick the Boys and/or Girls grades it's for.`;
    out.push({ name: name || `Fee ${i + 1}`, fee: raw ? Math.round(Number(raw) * 100) : null, endsOn, boys, girls });
  }
  return out;
}

const pickList = <T extends string>(v: unknown, all: readonly T[]): T[] =>
  Array.isArray(v) ? all.filter((x) => v.includes(x)) : [];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));
const optDate = (v: unknown): string | null | undefined => (v === "" || v === null || v === undefined ? null : isDate(v) ? v : undefined);
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

// Who may add and change an organization's player programs.
export async function managesPlayerPrograms(q: Pick<Queryable, "query">, viewer: SessionUser, org: string): Promise<boolean> {
  return (await hasFeature(q, org, "player-registration")) && (await orgHasArea(q, viewer.coachId, org, "events"));
}

// The team programs a season can take its dates from: Leagues, Circuits and Tournaments not ended yet, soonest first.
export async function seasonSources(q: Pick<Queryable, "query">, now: Date, keep: string | null = null) {
  const r = await q.query<{ id: string; name: string; startsOn: string; endsOn: string }>(
    `select id::text, name, to_char(starts_on, 'YYYY-MM-DD') as "startsOn", to_char(ends_on, 'YYYY-MM-DD') as "endsOn"
     from scenic_programs where ends_on >= $1::date or id::text = $2 order by starts_on, lower(name)`,
    [easternDate(now), keep],
  );
  return r.rows;
}

// A player program's fields for its form.
export async function playerProgramFields(q: Pick<Queryable, "query">, org: string, id: string): Promise<PlayerProgramFields | null> {
  if (!isId(id)) return null;
  const d = (c: string) => `coalesce(to_char(${c}, 'YYYY-MM-DD'), '')`;
  const r = await q.query<PlayerProgramFields>(
    `select id::text, name, ${d("reg_opens")} as "regOpens", ${d("reg_closes")} as "regCloses", ${d("pay_opens")} as "payOpens",
            ${d("pay_closes")} as "payCloses", coalesce(season_from::text, '') as "seasonFrom", ${d("starts_on")} as "startsOn",
            ${d("ends_on")} as "endsOn", kind, tryouts, open_gyms as "openGyms", scrimmages, coalesce(sessions::text, '') as sessions, grades, levels, genders,
            boys_grades as "boysGrades", girls_grades as "girlsGrades",
            coalesce((select json_agg(json_build_object('name', coalesce(l.name, 'Fee ' || l.position), 'fee', coalesce(to_char(l.fee_cents / 100.0, 'FM999999990.00'), ''),
                                                        'endsOn', coalesce(to_char(l.ends_on, 'YYYY-MM-DD'), ''),
                                                        'boysGrades', l.boys_grades, 'girlsGrades', l.girls_grades) order by l.position)
                        from program_fee_levels l where l.program_id = player_programs.id), '[]') as "feeLevels",
            ${d("tryout_reg_opens")} as "tryoutRegOpens", ${d("tryout_reg_closes")} as "tryoutRegCloses"
     from player_programs where id = $1 and org = $2`,
    [id, org],
  );
  return r.rows[0] ?? null;
}

// Add (id null) or change a player program. Returns its id.
export async function savePlayerProgram(
  deps: Deps,
  viewer: SessionUser,
  org: string,
  id: unknown,
  input: PlayerProgramInput,
): Promise<Result<{ id: string }>> {
  if (!(await managesPlayerPrograms(deps.pool, viewer, org)))
    return { ok: false, message: "Only an Admin or a Director of Events of this organization can change its programs." };
  if (id !== null && !isId(id)) return { ok: false, message: "That program no longer exists." };
  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80) return { ok: false, message: "Give the program a name (up to 80 letters)." };
  const payOpens = optDate(input.payOpens);
  const payCloses = optDate(input.payCloses);
  if (payOpens === undefined || payCloses === undefined) return { ok: false, message: "Check the dates." };
  if ((payOpens === null) !== (payCloses === null)) return { ok: false, message: "Give both payment dates, or neither." };
  if (payOpens && payCloses && payCloses < payOpens) return { ok: false, message: "Payments can't close before they open." };

  const kind: ProgramKind = input.kind === "Session" || input.kind === "Course" ? input.kind : "Season";
  // Its fee levels (when given): they say its genders and each gender's grades.
  const feeLevels = input.feeLevels === undefined ? null : cleanFeeLevels(input.feeLevels);
  if (typeof feeLevels === "string") return { ok: false, message: feeLevels };
  if (feeLevels) {
    input = {
      ...input,
      genders: PROGRAM_GENDERS.filter((g) => feeLevels.some((l) => (g === "Boys" ? l.boys : l.girls).length)),
      boysGrades: PROGRAM_GRADES.filter((g) => feeLevels.some((l) => l.boys.includes(g))),
      girlsGrades: PROGRAM_GRADES.filter((g) => feeLevels.some((l) => l.girls.includes(g))),
    };
  }
  // Its genders, and the grades for each (Boys K–8, Girls 3–8, say). Levels of play are a team's setting.
  const genders = input.genders === undefined ? [...PROGRAM_GENDERS] : pickList(input.genders, PROGRAM_GENDERS);
  if (!genders.length) return { ok: false, message: "Pick Boys, Girls or both." };
  const both = input.grades === undefined ? [...PROGRAM_GRADES] : pickList(input.grades, PROGRAM_GRADES);
  const gradesOf = (g: string, v: unknown) => (!genders.includes(g as never) ? [] : v === undefined ? both : pickList(v, PROGRAM_GRADES));
  const boysGrades = gradesOf("Boys", input.boysGrades);
  const girlsGrades = gradesOf("Girls", input.girlsGrades);
  for (const [g, list] of [["Boys", boysGrades], ["Girls", girlsGrades]] as const)
    if (genders.includes(g) && !list.length) return { ok: false, message: `Pick the ${g} grades.` };
  const grades = PROGRAM_GRADES.filter((g) => boysGrades.includes(g) || girlsGrades.includes(g));
  const levels = [...PROGRAM_LEVELS];
  const tryouts = kind === "Season" && input.tryouts === true; // with its tryout registration dates
  const openGyms = kind === "Season" && input.openGyms !== false;
  const scrimmages = kind === "Season" && input.scrimmages !== false;
  const sessionsN = kind === "Course" ? Number(input.sessions) : null;
  if (kind === "Course" && (!Number.isInteger(sessionsN) || sessionsN! < 2 || sessionsN! > 60))
    return { ok: false, message: "How many sessions? (2 to 60)" };
  // Tryout registration opens the day the program is added (kept when it's changed; a date given wins); each tryout's
  // closes on its own day (walk-ins register at the tryout), so different genders and grades close on different dates.
  let tryoutRegOpens: string | null = null;
  const tryoutRegCloses: string | null = null;
  if (tryouts) {
    if (input.tryoutRegOpens && !isDate(input.tryoutRegOpens)) return { ok: false, message: "Check the day tryout registration opens." };
    tryoutRegOpens = isDate(input.tryoutRegOpens) ? input.tryoutRegOpens : null;
    if (!tryoutRegOpens && id !== null && isId(id)) {
      const was = await deps.pool.query<{ o: string | null }>(
        "select to_char(tryout_reg_opens, 'YYYY-MM-DD') as o from player_programs where id = $1 and org = $2",
        [id, org],
      );
      tryoutRegOpens = was.rows[0]?.o ?? null;
    }
    tryoutRegOpens ??= easternDate(deps.now());
  }

  // Its season: from a team program, or typed in. A Season's end is its fees' latest Season end date (each fee has its
  // own, required when the dates are typed in); a Training Session is one day; a Course its first and last sessions.
  let seasonFrom: string | null = null;
  let startsOn: string | null = null;
  let endsOn: string | null = null;
  let seasonStart: string | null = null; // the day the season starts, typed in or its team program's
  const feeEnds = (feeLevels ?? []).map((l) => l.endsOn);
  if (input.seasonFrom) {
    if (!isId(input.seasonFrom)) return { ok: false, message: "Pick the program its season follows." };
    const s = await deps.pool.query<{ s: string | null }>("select to_char(starts_on, 'YYYY-MM-DD') as s from scenic_programs where id = $1", [
      input.seasonFrom,
    ]);
    if (!s.rowCount) return { ok: false, message: "That program no longer exists." };
    seasonFrom = input.seasonFrom;
    seasonStart = s.rows[0].s;
  } else {
    if (!isDate(input.startsOn)) return { ok: false, message: kind === "Season" ? "Give the day the season starts." : "Give the first day." };
    startsOn = input.startsOn;
    if (kind === "Season" && feeLevels) {
      const missing = (feeLevels ?? []).findIndex((l) => !l.endsOn);
      if (missing >= 0) return { ok: false, message: `${feeLevels[missing].name}: give its season end date.` };
      const early = feeLevels.find((l) => l.endsOn! < startsOn!);
      if (early) return { ok: false, message: `${early.name}: its season can't end before it starts.` };
      endsOn = feeEnds.reduce((a, b) => (b && (!a || b > a) ? b : a), null as string | null);
    } else {
      if (!isDate(input.endsOn)) return { ok: false, message: "Give the season's first and last days." };
      endsOn = input.endsOn;
    }
    if (endsOn! < startsOn) return { ok: false, message: "The season can't end before it starts." };
    seasonStart = startsOn;
  }
  // A fee's own season end can't be before the season starts.
  for (const [i, l] of (feeLevels ?? []).entries())
    if (l.endsOn && seasonStart && l.endsOn < seasonStart) return { ok: false, message: `${l.name || `Fee ${i + 1}`}: its season can't end before it starts.` };
  // Registration opens 60 days before the season starts and closes on the Season end date (each fee's own; the program
  // stays open until its last fee's closes).
  const regOpens = seasonStart ? addDays(seasonStart, -60) : isDate(input.regOpens) ? input.regOpens : easternDate(deps.now());
  const regCloses = kind === "Season" && feeEnds.length && feeEnds.every(Boolean) ? endsOn ?? feeEnds.reduce((a, b) => (b! > a! ? b : a)) : null;

  const values = [name, regOpens, regCloses, payOpens, payCloses, seasonFrom, startsOn, endsOn, by(viewer), deps.now(),
    kind, tryouts, openGyms, grades, levels, genders, tryoutRegOpens, tryoutRegCloses, scrimmages, sessionsN, boysGrades, girlsGrades];
  // The program and its fee levels, together (one transaction).
  const saveLevels = async (q: Pick<Queryable, "query">, pid: string) => {
    if (!feeLevels) return;
    await q.query("delete from program_fee_levels where program_id = $1", [pid]);
    for (const [i, l] of feeLevels.entries())
      await q.query(
        `insert into program_fee_levels (program_id, position, name, fee_cents, ends_on, boys_grades, girls_grades, set_by, set_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [pid, i + 1, l.name, l.fee, l.endsOn, l.boys, l.girls, by(viewer), deps.now()],
      );
  };
  try {
    return await withTx(deps.pool, async (q) => {
      if (id === null) {
        const r = await q.query<{ id: string }>(
          `insert into player_programs (org, name, reg_opens, reg_closes, pay_opens, pay_closes, season_from, starts_on, ends_on,
                                        created_by, created_at, kind, tryouts, open_gyms, grades, levels, genders,
                                        tryout_reg_opens, tryout_reg_closes, scrimmages, sessions, boys_grades, girls_grades)
           values ($23, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) returning id::text`,
          [...values, org],
        );
        await saveLevels(q, r.rows[0].id);
        return { ok: true as const, id: r.rows[0].id };
      }
      const r = await q.query(
        `update player_programs set name = $1, reg_opens = $2, reg_closes = $3, pay_opens = $4, pay_closes = $5, season_from = $6,
                starts_on = $7, ends_on = $8, updated_by = $9, updated_at = $10, kind = $11, tryouts = $12, open_gyms = $13,
                grades = $14, levels = $15, genders = $16, tryout_reg_opens = $17, tryout_reg_closes = $18,
                scrimmages = $19, sessions = $20, boys_grades = $21, girls_grades = $22
         where id = $23 and org = $24`,
        [...values, id, org],
      );
      if (!r.rowCount) return { ok: false as const, message: "That program no longer exists." };
      await saveLevels(q, id as string);
      return { ok: true as const, id: id as string };
    });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return { ok: false, message: `There's already a program named ${name}.` };
    throw e;
  }
}

// Delete a player program, only while it's empty: no registrations and no Sessions.
export async function deletePlayerProgram(deps: Deps, viewer: SessionUser, org: string, id: unknown): Promise<Result> {
  if (!(await managesPlayerPrograms(deps.pool, viewer, org)))
    return { ok: false, message: "Only an Admin or a Director of Events of this organization can change its programs." };
  if (!isId(id)) return { ok: false, message: "That program no longer exists." };
  const r = await deps.pool.query(
    `delete from player_programs p where p.id = $1 and p.org = $2
       and not exists (select 1 from registrations r where r.program_id = p.id)
       and not exists (select 1 from events e where e.program_id = p.id)`,
    [id, org],
  );
  if (r.rowCount) return { ok: true };
  const there = await deps.pool.query("select 1 from player_programs where id = $1 and org = $2", [id, org]);
  return there.rowCount
    ? { ok: false, message: "This program has players or Sessions, so it can't be deleted." }
    : { ok: false, message: "That program no longer exists." };
}
