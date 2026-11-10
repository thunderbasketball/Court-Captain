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
import { logoType, type Logo } from "./org-signup";
import { REG_OPTIONS, closedReason, planChoice, type Choice, type ChoiceResult, type ProgramOption, type SingleKind } from "./program-options";
import { clubAbbr } from "./scenic-club-teams";
import { cleanPlaceName } from "./scenic-partners";
import { LEVELS, gradeLabel, gradeRange, teamsICanManage, type Level } from "./scenic-teams";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";
import { scheduledGames, type ScheduledGame } from "./scenic-games";

export { REG_OPTIONS, type ProgramOption, type RegOptionKind } from "./program-options";

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
// Admins and Directors of Scheduling take teams out of a Game Day, the Brackets or a whole program (and restore them).
export const isScheduler = (q: Pick<Queryable, "query">, viewer: SessionUser) => orgHasArea(q, viewer.coachId, ORG, "scheduling");

async function inScenicCity(q: Queryable, viewer: SessionUser): Promise<boolean> {
  const r = await q.query(
    `select 1 where acts_as($1, 'scenic-city', 'Director')
       or exists (select 1 from org_roles where coach_id = $1 and org = 'scenic-city' and role <> 'Request')`,
    [viewer.coachId],
  );
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
  feeCents: number | null; // Circuits and Tournaments; a League's fees are on its options
  options: ProgramOption[]; // a League's Registration Options, in REG_OPTIONS order
  status: RegStatus;
  divisions: number;
  teams: number;
  logo: string | null; // its logo's link (PROGRAM_LOGO_SQL), when it has one
  recLimited: boolean; // REC open only to the organizations picked (REC open to)
};

// A program's logo link; the ?v= changes when the logo does, so browsers can keep it. `p` is scenic_programs.
export const PROGRAM_LOGO_SQL = `case when p.logo is not null
    then '/program-logo/' || p.id || '?v=' || extract(epoch from p.logo_updated_at)::bigint end`;

const SUMMARY = `select p.id::text, p.kind, p.name, p.starts_on::text as "startsOn", p.ends_on::text as "endsOn",
    p.reg_opens::text as "regOpens", p.reg_closes::text as "regCloses", p.fee_cents as "feeCents",
    (select count(*)::int from scenic_divisions d where d.program_id = p.id) as divisions,
    (select count(*)::int from scenic_registrations r where r.program_id = p.id) as teams, ${PROGRAM_LOGO_SQL} as logo,
    p.rec_limited_by is not null as "recLimited",
    coalesce((select json_agg(json_build_object('kind', o.kind, 'feeCents', o.fee_cents, 'closesOn', o.closes_on::text,
                                                'closesDaysBefore', o.closes_days_before)
                              order by array_position(array['all_season', 'single_1', 'single_2', 'single_2nd'], o.kind))
              from scenic_program_options o where o.program_id = p.id), '[]') as options
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

export type TeamCoach = { key: string; name: string; head: boolean };

// A Scenic City team's coaches (for alias t), as JSON: its Head Coach ("u:<coach id>", or "w:<club>:<name>" while they
// wait for a cell), the Head and Assistant Coaches of the Thunder or organization team it comes from, and each binding
// made by hand on the Scheduler ("b:<binding id>", named by its reason), which links teams the same way. The Scheduler
// links teams that share anyone here and never has one person at two games at once.
export const TEAM_COACHES = `coalesce((select json_agg(k order by k.head desc, k.name) from (
    select distinct on (x.key) x.key, x.name, x.head from (
      select 'u:' || u.coach_id as key, u.first_name || ' ' || u.last_name as name, p.role = 'HeadCoach' as head
        from (select t.coach_id as id, 'HeadCoach' as role where t.coach_id is not null
              union all
              select s.coach_id, s.role from team_staff s
               where s.team_id = t.thunder_team_id and s.role in ('HeadCoach', 'AsstCoach')
              union all
              select oc.coach_id, oc.role from org_team_coaches oc where oc.team_id = t.org_team_id) p
        join users u on u.coach_id = p.id
      union all
      select 'w:' || coalesce(t.partner_id::text, t.owner_coach_id) || ':' || lower(t.coach_first || ' ' || t.coach_last),
             t.coach_first || ' ' || t.coach_last, true
       where t.coach_id is null and t.coach_first is not null
      union all
      select 'b:' || bt.binding_id, coalesce(b.reason, 'Bound by hand'), false
        from scenic_binding_teams bt join scenic_bindings b on b.id = bt.binding_id where bt.team_id = t.id
    ) x order by x.key, x.head desc
  ) k), '[]')`;

export type RegisteredTeam = {
  teamId: string;
  name: string;
  gradeLabel: string;
  level: Level;
  from: string; // partner name, or "Solo · owner"
  tag: string; // shown in parentheses after the name: its organization's or club's Abbreviation, or "Solo"
  partnerId: string | null; // the school or organization it comes from (its home gyms on the Scheduler Grid)
  coach: string | null; // an organization's team may have no Head Coach yet
  coachCell: string | null;
  // Everyone who coaches it: its Head Coach (a login, or a name waiting for a cell) and the Assistant Coaches of the
  // Thunder or organization team it comes from. A key is the same on each team one person coaches.
  coaches: TeamCoach[];
  registeredBy: string;
  movedBy: string | null;
  paid: boolean;
  paidSetBy: string | null;
  canWithdraw: boolean;
  entry: Entry | null; // a League: what it registered for (1GG/2GG per date, brackets, fee)
  removedBy: string | null; // taken out of the whole program (still listed, crossed out)
  off: Record<string, string>; // taken out of a Game Day (YYYY-MM-DD) or "brackets" → by whom
};
export type PoolView = { id: string; name: string; teams: RegisteredTeam[] };
export type GradeGroup = { id: string; grade: number; level: Level; label: string; pools: PoolView[] };
export type DivisionView = {
  id: string;
  gender: "Boys" | "Girls" | "Coed";
  gradeLow: number;
  gradeHigh: number;
  label: string;
  teams: number;
  groups: GradeGroup[];
};

export type ProgramDetail = ProgramSummary & {
  today: string; // Eastern, YYYY-MM-DD
  gameDates: string[]; // the program's Game Days (regular season), YYYY-MM-DD, soonest first
  bracketDates: string[]; // its Bracket Days (post-season brackets at the end)
  createdBy: string;
  updatedBy: string;
  divisionList: DivisionView[];
  canManage: boolean;
  canSchedule: boolean; // take teams out of a day, the Brackets or the program, and restore them
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
    deps.pool.query<{ day: string; kind: "game" | "bracket" }>(
      `select to_char(g.day, 'YYYY-MM-DD') as day, pg.kind from program_game_days pg join game_days g on g.id = pg.game_day_id
       where pg.program_id = $1 order by g.day`,
      [id],
    ),
    deps.pool.query<{ id: string; gender: "Boys" | "Girls" | "Coed"; gradeLow: number; gradeHigh: number }>(
      `select id::text, gender, grade_low as "gradeLow", grade_high as "gradeHigh" from scenic_divisions
       where program_id = $1 order by grade_low = -1 desc, gender, grade_low`,
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
      partner_abbr: string | null;
      solo_account: boolean | null;
      partner_id: string | null;
      owner: string | null;
      coach: string;
      coach_cell: string;
      coaches: TeamCoach[];
      registered_by: string;
      moved_by: string | null;
      paid: boolean;
      paid_set_by: string | null;
      removed_by: string | null;
      off: Record<string, string>;
    }>(
      `select r.pool_id::text, t.id::text as team_id, t.name, t.grade_low, t.grade, t.level, p.name as partner, coalesce(og.abbr, p.abbr) as partner_abbr, og.kind = 'Team' as solo_account, t.partner_id::text,
              o.first_name || ' ' || o.last_name as owner, c.first_name || ' ' || c.last_name as coach, c.cell as coach_cell,
              ${TEAM_COACHES} as coaches,
              r.registered_by, r.moved_by, r.paid, r.paid_set_by, r.removed_by,
              coalesce((select json_object_agg(x.off, x.set_by) from scenic_team_off x
                        where x.program_id = r.program_id and x.team_id = r.team_id), '{}') as off
       from scenic_registrations r join scenic_teams t on t.id = r.team_id left join users c on c.coach_id = t.coach_id
       left join partners p on p.id = t.partner_id left join organizations og on og.slug = p.org_slug
       left join users o on o.coach_id = t.owner_coach_id
       where r.program_id = $1 order by lower(t.name)`,
      [id],
    ),
    isProgramsDirector(deps.pool, viewer),
    teamsICanManage(deps.pool, viewer),
  ]);
  const rec = await recLimit(deps.pool, id);
  const recOk = (t: { level: string; partnerId: string | null }) =>
    t.level !== "REC" || !rec.limited || (!!t.partnerId && rec.partners.includes(t.partnerId));
  const mineIds = new Set(mine.map((t) => t.id));
  const registered = new Set(regs.rows.map((r) => r.team_id));
  const league = prog.kind === "League";
  const [terms, picked] = league
    ? await Promise.all([leagueTerms(deps.pool, id), choices(deps.pool, id)])
    : [null, new Map<string, Choice>()];
  const team = (r: (typeof regs.rows)[number]): RegisteredTeam => ({
    teamId: r.team_id,
    name: r.name,
    gradeLabel: gradeLabel(r.grade_low, r.grade),
    level: r.level,
    from: r.partner ?? `Solo · ${r.owner}`,
    tag: r.partner && !r.solo_account ? (r.partner_abbr ?? clubAbbr(r.partner)) : "Solo",
    partnerId: r.partner_id,
    coach: r.coach,
    coachCell: r.coach_cell,
    coaches: r.coaches,
    registeredBy: r.registered_by,
    movedBy: r.moved_by,
    paid: r.paid,
    paidSetBy: r.paid_set_by,
    canWithdraw: manage || (status === "open" && mineIds.has(r.team_id)),
    entry: terms && picked.has(r.team_id) ? entryOf(picked.get(r.team_id)!, terms) : null,
    removedBy: r.removed_by,
    off: r.off,
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
      if (d && g && !recOk(t)) cantRegister.push({ name: t.name, why: "REC here is only for the organizations Scenic City picked" });
      else if (d && g)
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
    gameDates: dates.rows.filter((r) => r.kind === "game").map((r) => r.day),
    bracketDates: dates.rows.filter((r) => r.kind === "bracket").map((r) => r.day),
    divisionList,
    canManage: manage,
    canSchedule: await isScheduler(deps.pool, viewer),
    canRegister,
    cantRegister,
  };
}

// ---- Teams by date (a League's page and the Scheduler) ----

export type DateTeam = RegisteredTeam & {
  division: string; // "Boys 3rd–4th · 4th REC"
  divisionId: string;
  divisionName: string; // "Boys 3rd–4th"
  group: string; // "4th REC"
  groupGrade: number; // the grade group's grade (a 3rd/4th team plays as 4th)
  note: string; // "1GG", "2GG" or "Bracket"
  out: string | null; // taken out of (or withdrew from) this date or the Brackets: by whom
};
export type DateEvent = {
  key: string; // the date, or "brackets"
  date: string; // the Game Day, or the first Bracket Day
  lastDate: string; // the same, or the last Bracket Day
  bracket: boolean;
  teams: DateTeam[]; // Boys then Girls by grade (division order); those out are listed, crossed out
  playing: number; // teams still in
  games: number; // games guaranteed that day (teams still in)
};

// A League's Game Days, each with its teams (1GG/2GG), then the Brackets as one event over its Bracket Days (teams play
// until they lose): the teams in the brackets. Other kinds of programs: none.
export function teamsByDate(p: ProgramDetail): DateEvent[] {
  if (p.kind !== "League") return [];
  const registered = p.divisionList.flatMap((d) =>
    d.groups.flatMap((g) =>
      g.pools.flatMap((o) =>
        o.teams.map((t) => ({
          ...t,
          division: `${d.label} · ${g.label}`,
          divisionId: d.id,
          divisionName: d.label,
          group: g.label,
          groupGrade: g.grade,
        })),
      ),
    ),
  );
  const inPlay = (t: DateTeam) => !t.removedBy && !t.out;
  const days: DateEvent[] = p.gameDates.map((date) => {
    const teams = registered
      .filter((t) => t.entry?.perDate[date])
      .map((t) => ({ ...t, note: `${t.entry!.perDate[date]}GG`, out: t.off[date] ?? null }));
    const games = teams.filter(inPlay).reduce((n, t) => n + t.entry!.perDate[date], 0);
    return { key: date, date, lastDate: date, bracket: false, teams, playing: teams.filter(inPlay).length, games };
  });
  if (p.bracketDates.length) {
    const teams = registered.filter((t) => t.entry?.bracket).map((t) => ({ ...t, note: "Bracket", out: t.off.brackets ?? null }));
    days.push({
      key: "brackets",
      date: p.bracketDates[0],
      lastDate: p.bracketDates.at(-1)!,
      bracket: true,
      teams,
      playing: teams.filter(inPlay).length,
      games: 0,
    });
  }
  return days;
}

export type ScheduleDay = {
  date: string; // YYYY-MM-DD
  playing: number; // teams still in, every League that day
  games: number; // games guaranteed, every League that day
  programs: (DateEvent & {
    programId: string;
    programName: string;
    bracketDays: string[];
    matchups: Matchup[];
    otherDays: Record<string, string[]>; // pair "a-b" (lower id first) → the League's other Game Days they play
    // Each team's matchups on every Game Day of the League (past ones too), soonest first.
    teamGames: Record<string, ScheduledGame[]>;
  })[];
};
// One game in a division on a Game Day (team ids; names come from the day's teams).
export type Matchup = {
  id: string;
  divisionId: string;
  a: string;
  b: string | null; // null: TBD (no opponent yet)
  home: "a" | "b"; // which side is home (TBD games: "b" means the team is away)
  before: string[]; // the League's other Game Days these two also play (YYYY-MM-DD)
  createdBy: string;
  court: string | null; // its game slot on the Grid: the court key and start time ("HH:MM"), or null
  starts: string | null;
  placedBy: string | null;
};

// The Scheduler (Admins and Directors of Scheduling): every League's upcoming Game Days (and Brackets, on their first
// Bracket Day) on one list, soonest first, each with the teams playing. Null for anyone else.
export async function gameDaySchedule(deps: Deps, viewer: SessionUser): Promise<{ today: string; days: ScheduleDay[] } | null> {
  if (!(await isScheduler(deps.pool, viewer))) return null;
  const today = easternDate(deps.now());
  const ids = await deps.pool.query<{ id: string }>(
    `select id::text from scenic_programs where kind = 'League' and ends_on >= $1::date order by starts_on, lower(name)`,
    [today],
  );
  // Every matchup in these Leagues (all days, to show pairs that also meet on another Game Day).
  const all = await deps.pool.query<Matchup & { programId: string; day: string }>(
    `select m.id::text, m.program_id::text as "programId", m.division_id::text as "divisionId", m.day::text,
            m.team_a::text as a, m.team_b::text as b, coalesce(m.home_side, 'a') as home, m.created_by as "createdBy",
            m.court_key as court, to_char(m.starts, 'HH24:MI') as starts, m.placed_by as "placedBy"
       from scenic_matchups m where m.program_id = any($1::bigint[])
      order by m.day, m.id`,
    [ids.rows.map((r) => r.id)],
  );
  const pair = (m: { programId: string; a: string; b: string | null }) => `${m.programId}:${m.a}-${m.b ?? "TBD"}`;
  const daysOf = new Map<string, string[]>();
  for (const m of all.rows) daysOf.set(pair(m), [...(daysOf.get(pair(m)) ?? []), m.day]);
  const byDay = new Map<string, ScheduleDay>();
  for (const { id } of ids.rows) {
    const p = await getProgram(deps, viewer, id);
    if (!p) continue;
    // Each team's games in this League, with where and when once placed on the Grid.
    const games = await scheduledGames(
      deps.pool,
      p.divisionList.flatMap((d) => d.groups.flatMap((g) => g.pools.flatMap((o) => o.teams.map((t) => t.teamId)))),
    );
    for (const list of Object.values(games)) list.splice(0, list.length, ...list.filter((g) => g.programId === p.id));
    for (const e of teamsByDate(p)) {
      if (e.lastDate < today) continue;
      const day = byDay.get(e.date) ?? { date: e.date, playing: 0, games: 0, programs: [] };
      const matchups = e.bracket
        ? []
        : all.rows
            .filter((m) => m.programId === p.id && m.day === e.date)
            .map(({ id, divisionId, a, b, home, createdBy, programId, court, starts, placedBy }) => ({
              id,
              divisionId,
              a,
              b,
              home,
              createdBy,
              court,
              starts,
              placedBy,
              before: daysOf.get(pair({ programId, a, b }))!.filter((d) => d !== e.date),
            }));
      const otherDays: Record<string, string[]> = {};
      if (!e.bracket)
        for (const m of all.rows)
          if (m.programId === p.id && m.day !== e.date && m.b) (otherDays[`${m.a}-${m.b}`] ??= []).push(m.day);
      day.programs.push({
        ...e,
        programId: p.id,
        programName: p.name,
        bracketDays: e.bracket ? p.bracketDates : [],
        matchups,
        otherDays,
        teamGames: e.bracket ? {} : games,
      });
      day.playing += e.playing;
      day.games += e.games;
      byDay.set(e.date, day);
    }
  }
  return { today, days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

// ---- Directors of Programs: create, edit, delete ----

export type ProgramInput = {
  kind: unknown;
  name: unknown;
  startsOn: unknown;
  endsOn: unknown;
  regOpens: unknown;
  regCloses: unknown;
  fee: unknown; // dollars, e.g. "150" or "150.00"; blank for none (Circuits and Tournaments)
  options?: unknown; // a League's Registration Options: [{ kind, fee, closesOn?, closesDaysBefore? }] (fee in dollars)
};

const cents = (v: unknown): number | null => {
  const t = typeof v === "string" ? v.trim().replace(/^\$/, "") : typeof v === "number" ? String(v) : "";
  if (!t) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) throw new ProgramError("Enter fees in dollars, like 150 or 150.00.");
  return Math.round(Number(t) * 100);
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
  // A League's fees are on its Registration Options (at least one); others have one fee per team.
  let options: ProgramOption[] = [];
  let feeCents: number | null = null;
  if (kind === "League") {
    // Nothing given (older callers): ALL Season at the fee.
    const list =
      input.options === undefined
        ? [{ kind: "all_season", fee: input.fee }]
        : Array.isArray(input.options)
          ? (input.options as { kind?: unknown; fee?: unknown; closesOn?: unknown; closesDaysBefore?: unknown }[])
          : [];
    options = REG_OPTIONS.filter((o) => list.some((x) => x?.kind === o.key)).map((o) => {
      const x = list.find((y) => y?.kind === o.key)!;
      // Its own close: a date within the registration window, or 0–365 days before the event; never both.
      const on = x.closesOn === undefined || x.closesOn === null || x.closesOn === "" ? null : x.closesOn;
      const days = x.closesDaysBefore === undefined || x.closesDaysBefore === null || x.closesDaysBefore === "" ? null : Number(x.closesDaysBefore);
      if (on !== null && days !== null) throw new ProgramError(`${o.name}: pick a close date or days before, not both.`);
      if (on !== null && (!isDate(on) || on < regOpens || on > regCloses))
        throw new ProgramError(`${o.name}: its close date must be within registration (${regOpens} to ${regCloses}).`);
      if (days !== null && !(Number.isInteger(days) && days >= 0 && days <= 365))
        throw new ProgramError(`${o.name}: days before must be a whole number from 0 to 365.`);
      return { kind: o.key, feeCents: cents(x.fee), closesOn: on as string | null, closesDaysBefore: days };
    });
    if (!options.length) throw new ProgramError("Pick at least one Registration Option.");
    if (options.some((o) => o.kind === "single_2nd") && !options.some((o) => o.kind === "all_season" || o.kind === "single_1"))
      throw new ProgramError("Add a 2nd Game needs ALL Season or 1 Game – Single Day too.");
  } else feeCents = cents(input.fee);
  return { kind, name, startsOn, endsOn, regOpens, regCloses, feeCents, options };
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
      await q.query("delete from scenic_program_options where program_id = $1 and kind <> all($2::text[])", [
        pid,
        f.options.map((o) => o.kind),
      ]);
      for (const o of f.options)
        await q.query(
          `insert into scenic_program_options (program_id, kind, fee_cents, closes_on, closes_days_before) values ($1, $2, $3, $4, $5)
           on conflict (program_id, kind) do update
             set fee_cents = excluded.fee_cents, closes_on = excluded.closes_on, closes_days_before = excluded.closes_days_before`,
          [pid, o.kind, o.feeCents, o.closesOn ?? null, o.closesDaysBefore ?? null],
        );
      return { id: pid };
    });
  });
}

export async function deleteProgram(deps: Deps, viewer: SessionUser, id: unknown): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That program no longer exists." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      // Never with teams registered (sitting out counts): withdraw them first.
      const p = await q.query<{ teams: number }>(
        `select (select count(*)::int from scenic_registrations r where r.program_id = p.id) as teams
           from scenic_programs p where p.id = $1 for update`,
        [id],
      );
      if (!p.rows[0]) throw new ProgramError("That program no longer exists.");
      const n = p.rows[0].teams;
      if (n) throw new ProgramError(`It has ${n} team${n === 1 ? "" : "s"} registered. Withdraw them first.`);
      const r = await q.query("delete from scenic_programs where id = $1", [id]);
      if (!r.rowCount) throw new ProgramError("That program no longer exists.");
      return {};
    }),
  );
}

// A program's logo (Directors of Programs): PNG, JPEG or WebP up to 512 KB, checked by its first bytes. null removes it.
export async function setProgramLogo(deps: Deps, viewer: SessionUser, id: unknown, logo: Logo): Promise<Result> {
  if (!isId(id)) return { ok: false, message: "That program no longer exists." };
  if (logo) {
    if (logo.bytes.length > 512 * 1024) return { ok: false, message: "The logo must be 512 KB or smaller." };
    if (!logoType(logo.bytes)) return { ok: false, message: "The logo must be a PNG, JPEG or WebP image." };
  }
  if (!(await isProgramsDirector(deps.pool, viewer))) return { ok: false, message: programsOnly };
  const r = await deps.pool.query(
    "update scenic_programs set logo = $2, logo_type = $3, logo_updated_by = $4, logo_updated_at = $5 where id = $1",
    [
      id,
      logo ? Buffer.from(logo.bytes) : null,
      logo ? logoType(logo.bytes) : null,
      `${viewer.firstName} ${viewer.lastName}`,
      deps.now(),
    ],
  );
  return r.rowCount ? { ok: true } : { ok: false, message: "That program no longer exists." };
}

// ---- Game dates (Directors of Programs) ----

// The calendar's changes in one go: `add` Game Days, `addBrackets` Bracket Days (an existing date in either list changes
// to that kind), `remove` dates. Added dates must be in the season and not past; each becomes a Scenic City game day
// (made if new). A removed date leaves the program; it stops being a game day unless another program plays then or
// partners already gave court hours for it (then it stays, and `kept` counts it).
export async function saveProgramDates(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  input: { add: unknown; addBrackets?: unknown; remove: unknown },
): Promise<Result<{ added: number; removed: number; kept: number }>> {
  if (!isId(programId)) return { ok: false, message: "That program no longer exists." };
  const list = (v: unknown) => (Array.isArray(v) ? [...new Set(v)] : null);
  const add = list(input.add);
  const brackets = list(input.addBrackets ?? []);
  const remove = list(input.remove);
  if (!add || !brackets || !remove || ![...add, ...brackets, ...remove].every(isDate))
    return { ok: false, message: "Those dates don't look right." };
  if (add.some((d) => brackets.includes(d))) return { ok: false, message: "A date is a Game Day or a Bracket Day, not both." };
  if (add.length + brackets.length + remove.length > 400) return { ok: false, message: "Too many dates at once." };
  if (!add.length && !brackets.length && !remove.length) return { ok: false, message: "Tap the dates to add or remove first." };
  const all = [...add, ...brackets];
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      const p = await q.query<{ starts: string; ends: string }>(
        "select starts_on::text as starts, ends_on::text as ends from scenic_programs where id = $1 for update",
        [programId],
      );
      if (!p.rows[0]) throw new ProgramError("That program no longer exists.");
      const { starts, ends } = p.rows[0];
      if (all.some((d) => d < starts || d > ends)) throw new ProgramError("Game dates must be within the program's season.");
      const today = easternDate(deps.now());
      if (all.some((d) => d < today) || remove.some((d) => d < today)) throw new ProgramError("Past game dates can't change.");
      await q.query(
        "insert into game_days (day, created_by) select d, $2 from unnest($1::date[]) d on conflict (day) do nothing",
        [all, by(viewer)],
      );
      let added = 0;
      for (const [days, kind] of [
        [add, "game"],
        [brackets, "bracket"],
      ] as const) {
        const a = await q.query<{ inserted: boolean }>(
          `insert into program_game_days (program_id, game_day_id, added_by, added_at, kind)
           select $1, g.id, $3, $4, $5 from game_days g where g.day = any($2::date[])
           on conflict (program_id, game_day_id) do update set kind = excluded.kind
           returning (xmax = 0) as inserted`,
          [programId, days, by(viewer), deps.now(), kind],
        );
        added += a.rows.filter((r) => r.inserted).length;
      }
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
      return { added, removed: r.rowCount ?? 0, kept: gone.length - (d.rowCount ?? 0) };
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
  const gender = input.gender === "Boys" || input.gender === "Girls" || input.gender === "Coed" ? input.gender : null;
  const levels = Array.isArray(input.levels) ? LEVELS.filter((l) => (input.levels as unknown[]).includes(l)) : [];
  const grade = (v: unknown) => (Number.isInteger(v) && (v as number) >= -1 && (v as number) <= 12 ? (v as number) : null);
  const from = grade(input.from);
  const to = grade(input.to);
  if (!gender) return { ok: false, message: "Pick Boys, Girls or Coed." };
  if (from === null || to === null) return { ok: false, message: "Pick the grades." };
  if (to < from) return { ok: false, message: "The last grade is before the first." };
  if (!levels.length) return { ok: false, message: "Pick COMP, REC or both." };
  // Pre-K (ages 3 and 4) is its own division: Coed, REC only. Coed is only for Pre-K.
  if ((gender === "Coed") !== (from === -1) || (from === -1 && to !== -1))
    return { ok: false, message: "Pre-K is its own Coed division (Pre-K only); Boys and Girls divisions start at K." };
  if (from === -1 && levels.some((l) => l !== "REC")) return { ok: false, message: "Pre-K is REC only." };
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

// Copy another program's divisions here: each with its grade groups (grade and level) and its pools' names, no teams.
// A division that would overlap one already here (same gender, a shared grade) is skipped and named.
export async function copyDivisions(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  fromProgramId: unknown,
): Promise<Result<{ copied: string[]; skipped: string[] }>> {
  if (!isId(programId) || !isId(fromProgramId)) return { ok: false, message: "Pick a program to copy from." };
  if (programId === fromProgramId) return { ok: false, message: "Pick another program to copy from." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      if (!(await q.query("select 1 from scenic_programs where id = $1 for update", [programId])).rowCount)
        throw new ProgramError("That program no longer exists.");
      const from = await q.query<{ id: string; gender: string; gradeLow: number; gradeHigh: number }>(
        `select id::text, gender, grade_low as "gradeLow", grade_high as "gradeHigh" from scenic_divisions
         where program_id = $1 order by grade_low = -1 desc, gender, grade_low`,
        [fromProgramId],
      );
      if (!from.rows.length) throw new ProgramError("That program has no divisions to copy.");
      const copied: string[] = [];
      const skipped: string[] = [];
      for (const d of from.rows) {
        const label = divisionLabel(d);
        const clash = await q.query(
          "select 1 from scenic_divisions where program_id = $1 and gender = $2 and grade_low <= $4 and grade_high >= $3 limit 1",
          [programId, d.gender, d.gradeLow, d.gradeHigh],
        );
        if (clash.rowCount) {
          skipped.push(label);
          continue;
        }
        const n = await q.query<{ id: string }>(
          "insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, $2, $3, $4) returning id::text",
          [programId, d.gender, d.gradeLow, d.gradeHigh],
        );
        await q.query(
          `with src as (select g.id, g.grade, g.level from scenic_grade_groups g where g.division_id = $1),
                ng as (insert into scenic_grade_groups (division_id, grade, level) select $2, grade, level from src returning id, grade, level)
           insert into scenic_pools (group_id, name)
           select ng.id, p.name from ng join src on src.grade = ng.grade and src.level = ng.level join scenic_pools p on p.group_id = src.id`,
          [d.id, n.rows[0].id],
        );
        copied.push(label);
      }
      return { copied, skipped };
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

export type GradeLevelInput = { gender: unknown; grade: unknown; level: unknown; on: unknown };

// Grades accepted (Directors of Programs): turn one grade at one level on or off, Boys and Girls separately. On adds its
// grade group (with Pool A) to the division holding that grade; off removes it, refused while teams are in it or when
// it's the division's last grade group (remove the division instead). Coed is Pre-K REC only: on adds the Coed Pre-K
// division, off removes it (refused while teams are in it).
export async function setGradeLevel(deps: Deps, viewer: SessionUser, programId: unknown, input: GradeLevelInput): Promise<Result> {
  if (!isId(programId)) return { ok: false, message: "That program no longer exists." };
  const gender = input.gender === "Boys" || input.gender === "Girls" || input.gender === "Coed" ? input.gender : null;
  const grade = Number.isInteger(input.grade) && (input.grade as number) >= -1 && (input.grade as number) <= 12 ? (input.grade as number) : null;
  const level = LEVELS.find((l) => l === input.level);
  if (!gender || grade === null || !level) return { ok: false, message: "Pick a grade and level." };
  if ((gender === "Coed") !== (grade === -1)) return { ok: false, message: "Coed is Pre-K only; Boys and Girls start at K." };
  if (gender === "Coed" && level !== "REC") return { ok: false, message: "Pre-K is REC only." };
  const label = `${gender} ${gradeLabel(grade, grade)} ${level}`;
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      if (gender === "Coed") {
        if (!(await q.query("select 1 from scenic_programs where id = $1 for update", [programId])).rowCount)
          throw new ProgramError("That program no longer exists.");
        const pk = await q.query<{ id: string; teams: number }>(
          `select d.id::text, (select count(*)::int from scenic_registrations r join scenic_pools o on o.id = r.pool_id
                                join scenic_grade_groups g on g.id = o.group_id where g.division_id = d.id) as teams
             from scenic_divisions d where d.program_id = $1 and d.gender = 'Coed'`,
          [programId],
        );
        const have = pk.rows[0];
        if (input.on === true) {
          if (!have) {
            const d = await q.query<{ id: string }>(
              `insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Coed', -1, -1) returning id::text`,
              [programId],
            );
            await q.query(
              `with g as (insert into scenic_grade_groups (division_id, grade, level) values ($1, -1, 'REC') returning id)
               insert into scenic_pools (group_id, name) select id, 'Pool A' from g`,
              [d.rows[0].id],
            );
          }
          return {};
        }
        if (!have) return {};
        if (have.teams)
          throw new ProgramError(`Coed Pre-K has ${have.teams} team${have.teams === 1 ? "" : "s"}. Withdraw them first.`);
        await q.query("delete from scenic_divisions where id = $1", [have.id]);
        return {};
      }
      const d = await q.query<{ id: string }>(
        `select id::text from scenic_divisions where program_id = $1 and gender = $2 and grade_low <= $3 and grade_high >= $3
         for update`,
        [programId, gender, grade],
      );
      if (!d.rows[0]) throw new ProgramError(`No ${gender} division has ${gradeLabel(grade, grade)}. Add a division first.`);
      const divisionId = d.rows[0].id;
      const g = await q.query<{ id: string; teams: number }>(
        `select g.id::text, (select count(*)::int from scenic_registrations r join scenic_pools o on o.id = r.pool_id
                              where o.group_id = g.id) as teams
           from scenic_grade_groups g where g.division_id = $1 and g.grade = $2 and g.level = $3`,
        [divisionId, grade, level],
      );
      const have = g.rows[0];
      if (input.on === true) {
        if (!have)
          await q.query(
            `with g as (insert into scenic_grade_groups (division_id, grade, level) values ($1, $2, $3) returning id)
             insert into scenic_pools (group_id, name) select id, 'Pool A' from g`,
            [divisionId, grade, level],
          );
        return {};
      }
      if (!have) return {};
      if (have.teams)
        throw new ProgramError(`${label} has ${have.teams} team${have.teams === 1 ? "" : "s"}. Withdraw or move them first.`);
      const left = await q.query("select 1 from scenic_grade_groups where division_id = $1 and id <> $2 limit 1", [
        divisionId,
        have.id,
      ]);
      if (!left.rowCount) throw new ProgramError(`${label} is its division's last grade. Remove the division instead.`);
      await q.query("delete from scenic_grade_groups where id = $1", [have.id]);
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
  choice?: unknown, // a League: what the team registers for (ALL Season, Single Day dates); can be added to later
): Promise<Result<{ division: string | null; entry: Entry | null }>> {
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
      const r = await saveChoice(q, programId, teamId, choice, by(viewer), deps.now());
      if ("error" in r) throw new ProgramError(r.error);
      return r;
    }),
  );
}

// Register every team this person can register (the ones "Register a team" offers) that isn't in the program yet, each
// into its matching division (smallest pool); a League: ALL Season. Teams with no division here are skipped and say why.
// Same rules as one team: whoever manages the teams while registration is open, a Director of Programs any time.
// `preview`: what it would do, nothing kept (the confirmation before Register all).
export async function registerAllScenicTeams(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  preview = false,
  only?: unknown, // the teams left checked in the confirmation
): Promise<Result<BatchResult>> {
  if (!isId(programId)) return { ok: false, message: "Pick a program." };
  return run(() =>
    previewTx(
      deps.pool,
      async (q) => {
        const p = await q.query<{ reg_opens: string; reg_closes: string }>(
          "select reg_opens::text, reg_closes::text from scenic_programs where id = $1 for update",
          [programId],
        );
        if (!p.rows[0]) throw new ProgramError("That program no longer exists.");
        const manage = await isProgramsDirector(q, viewer);
        if (!manage && regStatus(easternDate(deps.now()), p.rows[0].reg_opens, p.rows[0].reg_closes) !== "open")
          throw new ProgramError("Registration isn't open for this program.");
        const done = new Set(
          (
            await q.query<{ id: string }>("select team_id::text as id from scenic_registrations where program_id = $1", [programId])
          ).rows.map((r) => r.id),
        );
        const teams = (await teamsICanManage(q, viewer)).filter((t) => !done.has(t.id));
        return registerBatch(
          q,
          { programId, org: ORG, viewer, now: deps.now(), preview, only },
          teams.map((t) => ({ id: t.id, name: t.name, teamId: async () => t.id })),
        );
      },
      (r) => r,
    ),
  );
}

// ---- Register all: a preview first, then the registrations as one batch that can be undone ----

export type BatchTeam = { id: string; name: string; division: string; dates: string[]; bracket: boolean }; // id: the team picked
export type BatchResult = { registered: string[]; skipped: string[]; teams: BatchTeam[]; batchId: string | null };

// A Register all that can't go ahead (returned as its message).
export class BatchError extends Error {}

class PreviewDone extends Error {
  constructor(readonly result: BatchResult) {
    super("preview");
  }
}

// Register all's loop, for Scenic City, Thunder and every organization: each team as ALL Season, the dates it plays,
// and the ones skipped (and why). `teamId` gives the team's Scenic City id (an organization's team is copied in first).
// `only`: the teams the Director left checked in the confirmation (by `id`); the others aren't registered this time.
// The registrations are one batch (Undo takes them out). `preview`: everything is rolled back (see previewTx), so the
// confirmation shows exactly what Register all will do.
export async function registerBatch(
  q: PoolClient,
  b: { programId: string; org: string; viewer: SessionUser; now: Date; preview: boolean; only?: unknown },
  all: { id: string; name: string; teamId: () => Promise<string> }[],
): Promise<BatchResult> {
  let teams = all;
  if (b.only !== undefined && b.only !== null) {
    if (!Array.isArray(b.only) || b.only.length > 1000 || !b.only.every(isId)) throw new BatchError("Pick the teams to register.");
    const keep = new Set<string>(b.only);
    teams = all.filter((t) => keep.has(t.id));
    if (!teams.length) throw new BatchError("Check at least one team to register.");
  }
  const registered: string[] = [];
  const skipped: string[] = [];
  const out: BatchTeam[] = [];
  const ids: string[] = [];
  for (const t of teams) {
    const id = await t.teamId();
    const placed = await saveChoice(q, b.programId, id, { allSeason: true, days: [] }, by(b.viewer), b.now);
    if ("error" in placed) {
      skipped.push(`${t.name}: ${placed.error}`);
      continue;
    }
    registered.push(`${t.name}: ${placed.division}`);
    ids.push(id);
    const e = placed.entry;
    out.push({ id: t.id, name: t.name, division: placed.division ?? "", dates: e ? Object.keys(e.perDate).sort() : [], bracket: !!e?.bracket });
  }
  const result: BatchResult = { registered, skipped, teams: out, batchId: null };
  if (b.preview) throw new PreviewDone(result);
  if (!ids.length) return result;
  const batch = await q.query<{ id: string }>(
    `insert into scenic_register_batches (program_id, org, teams, done_by, done_by_id, done_at)
     values ($1, $2, $3, $4, $5, $6) returning id::text`,
    [b.programId, b.org, ids.length, by(b.viewer), b.viewer.coachId, b.now],
  );
  await q.query("update scenic_registrations set batch_id = $1 where program_id = $2 and team_id = any($3::bigint[])", [
    batch.rows[0].id,
    b.programId,
    ids,
  ]);
  return { ...result, batchId: batch.rows[0].id };
}

// A transaction whose preview (registerBatch with `preview`) is rolled back and returned through `wrap`.
export async function previewTx<T>(pool: Pool, fn: (q: PoolClient) => Promise<T>, wrap: (r: BatchResult) => T): Promise<T> {
  try {
    return await withTx(pool, fn);
  } catch (e) {
    if (e instanceof PreviewDone) return wrap(e.result);
    if (e instanceof BatchError) return { ok: false, message: e.message } as T;
    throw e;
  }
}

// Put a team into a program's matching grade group, in its smallest pool. The caller has checked who may and when.
// ---- REC open to (Directors of Programs) ----

// SQL: true when a team of this level from this partner may register in the program (REC limited to picked organizations).
export const recOpenSql = (program: string, level: string, partner: string) =>
  `(${level} <> 'REC' or (select rec_limited_by from scenic_programs where id = ${program}) is null
    or exists (select 1 from scenic_program_rec_partners x where x.program_id = ${program} and x.partner_id = ${partner}))`;

async function recOpen(q: Pick<Queryable, "query">, programId: string, teamId: string): Promise<boolean> {
  const r = await q.query<{ ok: boolean }>(
    `select ${recOpenSql("$1", "t.level", "t.partner_id")} as ok from scenic_teams t where t.id = $2`,
    [programId, teamId],
  );
  return r.rows[0]?.ok ?? false;
}

// The organizations REC can be limited to: CourtSync (no CourtSync, no REC) and teams of its own (CourtOrg, or
// CourtPlayers like Thunder). Hosts with CourtSync only (high schools) and CourtSolo teams aren't listed. `p` is partners.
export const REC_ORG_SQL = (org: string) => `exists (select 1 from org_features f where f.org = ${org} and f.feature = 'court-sync')
  and exists (select 1 from org_features f where f.org = ${org} and f.feature in ('court-org', 'court-players'))`;
const REC_CHOICE_SQL = `p.approved and p.org_slug is not null and ${REC_ORG_SQL("p.org_slug")}`;

export type RecLimit = {
  limited: boolean;
  by: string | null;
  partners: string[]; // picked (partner ids)
  choices: { id: string; name: string }[]; // organizations that can be picked (CourtSync + CourtOrg or CourtPlayers), by name
};

export async function recLimit(q: Pick<Queryable, "query">, programId: string): Promise<RecLimit> {
  const [p, picked, choices] = await Promise.all([
    q.query<{ by: string | null }>("select rec_limited_by as by from scenic_programs where id = $1", [programId]),
    q.query<{ id: string }>("select partner_id::text as id from scenic_program_rec_partners where program_id = $1", [programId]),
    q.query<{ id: string; name: string }>(
      `select p.id::text, p.name from partners p where ${REC_CHOICE_SQL} order by lower(p.name)`,
    ),
  ]);
  return { limited: !!p.rows[0]?.by, by: p.rows[0]?.by ?? null, partners: picked.rows.map((r) => r.id), choices: choices.rows };
}

// REC open to everyone, or only the organizations picked (at least one). Teams already registered stay.
export async function setRecLimit(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  input: { limited: unknown; partners: unknown },
): Promise<Result> {
  if (!isId(programId)) return { ok: false, message: "That program no longer exists." };
  const limited = input.limited === true;
  const ids = Array.isArray(input.partners) ? [...new Set(input.partners)] : null;
  if (!ids || ids.length > 500 || !ids.every(isId)) return { ok: false, message: "Pick organizations from the list." };
  if (limited && !ids.length) return { ok: false, message: "Pick at least one organization, or open REC to everyone." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      if (!(await q.query("select 1 from scenic_programs where id = $1 for update", [programId])).rowCount)
        throw new ProgramError("That program no longer exists.");
      const who = `${viewer.firstName} ${viewer.lastName}`;
      await q.query("delete from scenic_program_rec_partners where program_id = $1", [programId]);
      if (limited) {
        const ok = await q.query(
          `select 1 from partners p where p.id = any($1::bigint[]) and ${REC_CHOICE_SQL}`,
          [ids],
        );
        if (ok.rowCount !== ids.length) throw new ProgramError("Pick organizations from the list.");
        await q.query(
          `insert into scenic_program_rec_partners (program_id, partner_id, added_by, added_at)
           select $1, unnest($2::bigint[]), $3, $4`,
          [programId, ids, who, deps.now()],
        );
      }
      await q.query("update scenic_programs set rec_limited_by = $2, rec_limited_at = $3 where id = $1", [
        programId,
        limited ? who : null,
        limited ? deps.now() : null,
      ]);
      return {};
    }),
  );
}

export async function addToPool(
  q: PoolClient,
  programId: string,
  teamId: string,
  byName: string,
  now: Date,
): Promise<{ division: string } | { error: string }> {
  const team = (
    await q.query<{ gender: string; grade: number; level: string; name: string }>(
      "select gender, grade, level, name from scenic_teams where id = $1 for share",
      [teamId],
    )
  ).rows[0];
  if (!team) return { error: "That team no longer exists." };
  if (!(await recOpen(q, programId, teamId)))
    return { error: `REC in this program is only for the organizations Scenic City picked. COMP is open to all.` };
  const pool = await poolFor(q, programId, team);
  if (!pool) return { error: `This program has no ${team.gender} ${ordinal(team.grade)} ${team.level}.` };
  const ins = await q.query(
    `insert into scenic_registrations (program_id, team_id, pool_id, registered_by, registered_at)
     values ($1, $2, $3, $4, $5) on conflict do nothing`,
    [programId, teamId, pool.id, byName, now],
  );
  if (!ins.rowCount) return { error: `${team.name} is already registered.` };
  return { division: `${divisionLabel(pool)} · ${groupLabel(team)} · ${pool.name}` };
}

// ---- What a team registers for in a League ----

const SINGLE: readonly SingleKind[] = ["single_1", "single_2nd", "single_2"];
export type Entry = Choice & ChoiceResult; // what it picked, and what that gives it

// The choice as sent from the browser, checked: ALL Season (true/false) and Single Day options on dates.
export function parseChoice(v: unknown): Choice | null {
  const c = v as { allSeason?: unknown; days?: unknown } | null;
  if (!c || typeof c !== "object" || !Array.isArray(c.days) || c.days.length > 200) return null;
  const days: Choice["days"] = [];
  for (const d of c.days as { date?: unknown; kind?: unknown }[]) {
    if (!d || !isDate(d.date) || !SINGLE.includes(d.kind as SingleKind)) return null;
    days.push({ date: d.date, kind: d.kind as SingleKind });
  }
  return { allSeason: c.allSeason === true, days };
}

// A League's options and Game Days (regular season, not Bracket Days), soonest first.
async function leagueTerms(q: Pick<Queryable, "query">, programId: string) {
  const [o, d] = await Promise.all([
    q.query<ProgramOption>(
      `select kind, fee_cents as "feeCents", closes_on::text as "closesOn", closes_days_before as "closesDaysBefore"
         from scenic_program_options where program_id = $1`,
      [programId],
    ),
    q.query<{ day: string }>(
      `select to_char(g.day, 'YYYY-MM-DD') as day from program_game_days pg join game_days g on g.id = pg.game_day_id
       where pg.program_id = $1 and pg.kind = 'game' order by g.day`,
      [programId],
    ),
  ]);
  return { options: o.rows, gameDates: d.rows.map((r) => r.day) };
}

// Each registered team's choice in a program (teams not registered are missing).
async function choices(q: Pick<Queryable, "query">, programId: string): Promise<Map<string, Choice>> {
  const r = await q.query<{ team_id: string; all_season: boolean; days: Choice["days"] }>(
    `select r.team_id::text, r.all_season,
            coalesce((select json_agg(json_build_object('date', to_char(g.day, 'YYYY-MM-DD'), 'kind', d.kind) order by g.day, d.kind)
                      from scenic_registration_days d join game_days g on g.id = d.game_day_id
                      where d.program_id = r.program_id and d.team_id = r.team_id), '[]') as days
     from scenic_registrations r where r.program_id = $1`,
    [programId],
  );
  return new Map(r.rows.map((x) => [x.team_id, { allSeason: x.all_season, days: x.days }]));
}

// What a choice gives, against the League's terms today (for showing; saved choices were checked when made).
function entryOf(c: Choice, terms: { options: ProgramOption[]; gameDates: string[] }): Entry {
  const r = planChoice(terms.options, terms.gameDates, { allSeason: false, days: [] }, c);
  return "error" in r ? { ...c, perDate: {}, bracket: c.allSeason, feeCents: 0 } : { ...c, ...r.result };
}

// Register a team (placed in its division's smallest pool), or add to its registration: for a League, the options and
// dates it picked (new dates not past). The caller has checked who may and when. Circuits and Tournaments: no choice.
export async function saveChoice(
  q: PoolClient,
  programId: string,
  teamId: string,
  choice: unknown,
  byName: string,
  now: Date,
  checkCloses = true, // each option's own close (false only for the FastBreak sync)
): Promise<{ error: string } | { division: string | null; entry: Entry | null }> {
  const kind = (await q.query<{ kind: string }>("select kind from scenic_programs where id = $1", [programId])).rows[0]?.kind;
  if (!kind) return { error: "That program no longer exists." };
  const registered = (await choices(q, programId)).get(teamId) ?? null;
  if (kind !== "League") {
    if (registered) return { error: "That team is already registered." };
    const placed = await addToPool(q, programId, teamId, byName, now);
    return "error" in placed ? placed : { division: placed.division, entry: null };
  }
  const add = parseChoice(choice);
  if (!add) return { error: "Pick ALL Season or at least one date." };
  const today = easternDate(now);
  if (add.days.some((d) => d.date < today)) return { error: "Past Game Days can't be picked." };
  const terms = await leagueTerms(q, programId);
  const had = registered ?? { allSeason: false, days: [] };
  const plan = planChoice(terms.options, terms.gameDates, had, add);
  if ("error" in plan) return plan;
  const closed = checkCloses ? closedReason(terms.options, terms.gameDates, had, add, today) : null;
  if (closed) return { error: closed };
  let division: string | null = null;
  if (!registered) {
    const placed = await addToPool(q, programId, teamId, byName, now);
    if ("error" in placed) return placed;
    division = placed.division;
  }
  await q.query("update scenic_registrations set all_season = $3 where program_id = $1 and team_id = $2", [
    programId,
    teamId,
    plan.merged.allSeason,
  ]);
  for (const d of add.days)
    await q.query(
      `insert into scenic_registration_days (program_id, team_id, game_day_id, kind, registered_by, registered_at)
       select $1, $2, g.id, $4, $5, $6 from game_days g where g.day = $3::date on conflict do nothing`,
      [programId, teamId, d.date, d.kind, byName, now],
    );
  return { division, entry: { ...plan.merged, ...plan.result } };
}

// A League's terms and one team's entry, for the registration pop-up.
export async function leagueEntry(
  q: Pick<Queryable, "query">,
  programId: string,
  teamId: string | null,
): Promise<{ options: ProgramOption[]; gameDates: string[]; entry: Entry | null }> {
  const terms = await leagueTerms(q, programId);
  const c = teamId ? ((await choices(q, programId)).get(teamId) ?? null) : null;
  return { ...terms, entry: c ? entryOf(c, terms) : null };
}

// A program's registration status today (locks it so registering and closing don't cross), or null if it's gone.
export async function programRegStatus(q: PoolClient, programId: string, now: Date): Promise<RegStatus | null> {
  const p = await q.query<{ reg_opens: string; reg_closes: string }>(
    "select reg_opens::text, reg_closes::text from scenic_programs where id = $1 for update",
    [programId],
  );
  return p.rows[0] ? regStatus(easternDate(now), p.rows[0].reg_opens, p.rows[0].reg_closes) : null;
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

// Admins and Directors of Scheduling: take a registered team out of one Game Day, the Brackets ("brackets") or the whole
// program ("program"), or restore it (`out` false). The team stays registered and listed; who did it is recorded.
export async function setTeamOff(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  teamId: unknown,
  what: unknown,
  out: boolean,
): Promise<Result> {
  if (!isId(programId) || !isId(teamId)) return { ok: false, message: "Pick a team." };
  if (what !== "program" && what !== "brackets" && !isDate(what)) return { ok: false, message: "Pick a date." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isScheduler(q, viewer)))
        throw new ProgramError("Only a Scenic City Admin or Director of Scheduling can do that.");
      const reg = await q.query("select 1 from scenic_registrations where program_id = $1 and team_id = $2 for update", [
        programId,
        teamId,
      ]);
      if (!reg.rowCount) throw new ProgramError("That team isn't registered.");
      if (what === "program") {
        await q.query("update scenic_registrations set removed_by = $3, removed_at = $4 where program_id = $1 and team_id = $2", [
          programId,
          teamId,
          out ? by(viewer) : null,
          out ? deps.now() : null,
        ]);
        return {};
      }
      if (isDate(what)) {
        const day = await q.query(
          `select 1 from program_game_days pg join game_days g on g.id = pg.game_day_id
           where pg.program_id = $1 and g.day = $2::date and pg.kind = 'game'`,
          [programId, what],
        );
        if (!day.rowCount) throw new ProgramError("That isn't one of this program's Game Days.");
      }
      if (out)
        await q.query(
          `insert into scenic_team_off (program_id, team_id, off, set_by, set_at) values ($1, $2, $3, $4, $5)
           on conflict do nothing`,
          [programId, teamId, what, by(viewer), deps.now()],
        );
      else
        await q.query("delete from scenic_team_off where program_id = $1 and team_id = $2 and off = $3", [
          programId,
          teamId,
          what,
        ]);
      return {};
    }),
  );
}

// Picked teams (check boxes on the program page): up to 500 distinct ids, or null when they aren't readable.
function pickedIds(teamIds: unknown): string[] | null {
  if (!Array.isArray(teamIds) || !teamIds.length || teamIds.length > 500 || !teamIds.every(isId)) return null;
  return [...new Set(teamIds as string[])];
}

// Admins and Directors of Scheduling: take the picked teams out of the whole program at once, or restore them (`out`
// false). Same as Remove on each team, in one transaction; who did it is recorded. Returns how many changed.
export async function setTeamsOff(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  teamIds: unknown,
  out: boolean,
): Promise<Result<{ changed: number }>> {
  const ids = pickedIds(teamIds);
  if (!isId(programId) || !ids) return { ok: false, message: "Pick at least one team." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isScheduler(q, viewer)))
        throw new ProgramError("Only a Scenic City Admin or Director of Scheduling can do that.");
      const r = await q.query(
        `update scenic_registrations set removed_by = $3, removed_at = $4
          where program_id = $1 and team_id = any($2::bigint[]) and (removed_by is null) = $5`,
        [programId, ids, out ? by(viewer) : null, out ? deps.now() : null, out],
      );
      return { changed: r.rowCount ?? 0 };
    }),
  );
}

// Directors of Programs: withdraw the picked teams at once (their registrations are deleted, as Withdraw on each team).
export async function withdrawTeams(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  teamIds: unknown,
): Promise<Result<{ withdrawn: number }>> {
  const ids = pickedIds(teamIds);
  if (!isId(programId) || !ids) return { ok: false, message: "Pick at least one team." };
  return run(() =>
    withTx(deps.pool, async (q) => {
      if (!(await isProgramsDirector(q, viewer))) throw new ProgramError(programsOnly);
      const p = await q.query("select 1 from scenic_programs where id = $1 for share", [programId]);
      if (!p.rowCount) throw new ProgramError("That program no longer exists.");
      const r = await q.query("delete from scenic_registrations where program_id = $1 and team_id = any($2::bigint[])", [
        programId,
        ids,
      ]);
      return { withdrawn: r.rowCount ?? 0 };
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
