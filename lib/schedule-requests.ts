// Schedule requests (SPEC.md section 13). A League turns them on for chosen Game Days (Directors of Programs or
// Scheduling, on the program's Game & Bracket Days). A registered team's Head or Assistant Coach then blocks up to 2 of
// the day's 4 time blocks; the team must be free for the others. Requests close (REC: 2 weeks before the League's first
// Game Day; COMP: the Sunday before the Game Day) and none are taken after. The Scheduler's Grid never places a game in
// a team's blocked block; a request that can't be met means the team sits out that day (the Scheduler takes it out).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { TEAM_COACHES, isProgramsDirector, isScheduler, leagueEntry } from "./scenic-programs";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";
import {
  DEFAULT_SETTINGS,
  RULES_NOTE,
  blockedBy,
  closesOn,
  parseSettings,
  type Block,
  type RequestSettings,
} from "./schedule-request-blocks";

export { BLOCKS, MAX_BLOCKED, RULES_NOTE, blockedBy, closesOn, type BlockKey } from "./schedule-request-blocks";

// A League's blocks and limit from its row (null: the standard 4 blocks, up to 2).
type SettingsRow = { blocks: Block[]; max: number; by?: string | null; comp?: number | null; rec?: number | null };
const settingsOf = (row: SettingsRow | null): RequestSettings =>
  row ? { blocks: row.blocks, max: row.max, setBy: row.by ?? null, compDays: row.comp ?? null, recDays: row.rec ?? null } : DEFAULT_SETTINGS;
const SETTINGS_SQL = (program: string) =>
  `(select json_build_object('blocks', s.blocks, 'max', s.max_blocked, 'by', s.set_by, 'comp', s.comp_days_before, 'rec', s.rec_days_before)
      from scenic_request_settings s where s.program_id = ${program})`;

// The League's schedule request blocks and limit (its Schedule requests gear).
export async function requestSettings(q: Pick<Queryable, "query">, programId: string): Promise<RequestSettings> {
  const r = await q.query<{ s: SettingsRow | null }>(`select ${SETTINGS_SQL("$1")} as s`, [programId]);
  return settingsOf(r.rows[0]?.s ?? null);
}

// Set the League's blocks, how many a team can check, and when requests close. Directors of Programs or Scheduling; who did it recorded.
// Requests already made keep only blocks that still exist (a removed block no longer counts).
export async function saveRequestSettings(deps: Deps, viewer: SessionUser, programId: unknown, input: unknown): Promise<Result> {
  if (!isId(programId)) return { ok: false, message: "Pick a League." };
  if (!(await isProgramsDirector(deps.pool, viewer)) && !(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Director of Programs or Scheduling can change this." };
  const s = parseSettings(input);
  if (!s.ok) return s;
  const p = await deps.pool.query("select 1 from scenic_programs where id = $1 and kind = 'League'", [programId]);
  if (!p.rowCount) return { ok: false, message: "That League no longer exists." };
  await deps.pool.query(
    `insert into scenic_request_settings (program_id, blocks, max_blocked, comp_days_before, rec_days_before, set_by, set_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (program_id) do update set blocks = excluded.blocks, max_blocked = excluded.max_blocked,
       comp_days_before = excluded.comp_days_before, rec_days_before = excluded.rec_days_before,
       set_by = excluded.set_by, set_at = excluded.set_at`,
    [programId, JSON.stringify(s.blocks), s.max, s.compDays, s.recDays, by(viewer), deps.now()],
  );
  return { ok: true };
}

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;

// The program's Game Days with requests on (for its Game & Bracket Days).
export async function requestDays(q: Pick<Queryable, "query">, programId: string): Promise<Record<string, string>> {
  const r = await q.query<{ day: string; by: string }>(
    `select g.day::text, d.requests_by as by from program_game_days d join game_days g on g.id = d.game_day_id
      where d.program_id = $1 and d.kind = 'game' and d.requests_at is not null`,
    [programId],
  );
  return Object.fromEntries(r.rows.map((x) => [x.day, x.by]));
}

// Turn requests on or off for one of the League's Game Days. Directors of Programs or Scheduling.
export async function setRequestDay(deps: Deps, viewer: SessionUser, programId: unknown, day: unknown, on: boolean): Promise<Result> {
  if (!isId(programId) || !isDate(day)) return { ok: false, message: "Pick a Game Day." };
  if (!(await isProgramsDirector(deps.pool, viewer)) && !(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Director of Programs or Scheduling can change this." };
  const r = await deps.pool.query(
    `update program_game_days d set requests_by = $3, requests_at = $4
       from game_days g where g.id = d.game_day_id and d.program_id = $1 and g.day = $2::date and d.kind = 'game'`,
    [programId, day, on ? by(viewer) : null, on ? deps.now() : null],
  );
  if (!r.rowCount) return { ok: false, message: "That isn't one of this League's Game Days." };
  return { ok: true };
}

// The team's Head or Assistant Coach (any coach the Scheduler links to it); the Owners, Admins and Directors of Teams of
// the organization it belongs to (an organization's team: that organization; Thunder's: Thunder) and of Scenic City (the
// League); or a Scenic City Director of Scheduling. Read straight from the roles (it runs inside transactions too).
export async function mayRequest(q: Pick<Queryable, "query">, viewer: SessionUser, teamId: string): Promise<boolean> {
  const w = await whoForTeam(q, viewer, teamId);
  return w.coach || w.director;
}

// Whether the viewer is one of the team's coaches, and whether they're one of its directors (its organization's or
// Scenic City's Owners, Admins and Directors of Teams, or the Scheduler). Read straight from the roles.
export async function whoForTeam(
  q: Pick<Queryable, "query">,
  viewer: SessionUser,
  teamId: string,
): Promise<{ coach: boolean; director: boolean; level: string | null }> {
  const r = await q.query<{ coach: boolean; director: boolean; level: string | null }>(
    `select exists(select 1 from scenic_teams t cross join lateral json_array_elements(${TEAM_COACHES}) x(c)
                    where t.id = $1 and x.c->>'key' = 'u:' || $2) as coach,
            exists(select 1 from scenic_teams t left join org_teams ot on ot.id = t.org_team_id
                    cross join lateral (values (coalesce(ot.org, case when t.thunder_team_id is not null then 'thunder' end)), ('scenic-city')) o(org)
                    where t.id = $1 and o.org is not null
                      and (acts_as($2, o.org, 'Admin')
                           or (has_role($2, o.org, 'Director')
                               and exists(select 1 from active_director_areas a where a.coach_id = $2 and a.org = o.org and a.area = 'teams')))) as director,
            (select level from scenic_teams where id = $1) as level`,
    [teamId, viewer.coachId],
  );
  const x = r.rows[0];
  return { coach: x.coach, director: x.director || (await isScheduler(q, viewer)), level: x.level };
}

export type RequestDay = {
  programId: string;
  program: string;
  day: string; // a Game Day, or "brackets"
  bracketDays: string[]; // the Brackets' dates (when known)
  games: number | null; // games guaranteed that day
  requests: boolean; // the League takes time requests that day (never during the Brackets)
  closes: string; // the last day to change time requests
  open: boolean; // time requests still open
  blocks: string[]; // the blocks checked (can't play)
  options: Block[]; // the League's blocks
  max: number; // how many can be checked
  setBy: string | null;
  off: "team" | "league" | null; // sitting out: the team chose it, or the League took it out
  offBy: string | null;
};

// A team's upcoming League dates (each Game Day it's entered for, then the Brackets if it's in them), with its time
// requests and sit-outs. Null when the viewer can't make them (the card shows only to the team's coaches and the
// Scheduler).
export async function teamRequests(deps: Deps, viewer: SessionUser, teamId: string | null): Promise<RequestDay[] | null> {
  if (!teamId || !isId(teamId) || !(await mayRequest(deps.pool, viewer, teamId))) return null;
  const today = easternDate(deps.now());
  const r = await deps.pool.query<{
    program_id: string;
    program: string;
    level: string;
    first_day: string | null;
    req_days: string[];
    bracket_days: string[];
    requests: Record<string, { blocks: string[]; by: string }>;
    offs: Record<string, { team: boolean; by: string }>;
    settings: SettingsRow | null;
  }>(
    `select p.id::text as program_id, p.name as program, t.level, ${SETTINGS_SQL("p.id")} as settings,
            (select min(g.day)::text from program_game_days d join game_days g on g.id = d.game_day_id
              where d.program_id = p.id and d.kind = 'game') as first_day,
            array(select g.day::text from program_game_days d join game_days g on g.id = d.game_day_id
                   where d.program_id = p.id and d.kind = 'game' and d.requests_at is not null) as req_days,
            array(select g.day::text from program_game_days d join game_days g on g.id = d.game_day_id
                   where d.program_id = p.id and d.kind = 'bracket' order by g.day) as bracket_days,
            coalesce((select json_object_agg(q.day::text, json_build_object('blocks', q.blocks, 'by', q.set_by))
                        from scenic_schedule_requests q where q.program_id = p.id and q.team_id = t.id), '{}') as requests,
            coalesce((select json_object_agg(o.off, json_build_object('team', o.by_team, 'by', o.set_by))
                        from scenic_team_off o where o.program_id = p.id and o.team_id = t.id), '{}') as offs
       from scenic_registrations r
       join scenic_teams t on t.id = r.team_id
       join scenic_programs p on p.id = r.program_id
      where r.team_id = $1 and r.removed_at is null and p.kind = 'League' and p.ends_on >= $2::date
      order by p.starts_on, p.name`,
    [teamId, today],
  );
  const out: RequestDay[] = [];
  for (const x of r.rows) {
    const { entry } = await leagueEntry(deps.pool, x.program_id, teamId);
    if (!entry) continue;
    const offOf = (k: string) => (x.offs[k] ? (x.offs[k].team ? ("team" as const) : ("league" as const)) : null);
    const set = settingsOf(x.settings);
    const { blocks: options, max } = set;
    const keys = new Set(options.map((b) => b.key));
    for (const day of Object.keys(entry.perDate).sort()) {
      if (day < today) continue;
      const closes = closesOn(x.level, day, x.first_day ?? day, set); // the League's own close days, if set
      const req = x.requests[day];
      out.push({
        programId: x.program_id,
        program: x.program,
        day,
        bracketDays: [],
        games: entry.perDate[day],
        requests: x.req_days.includes(day),
        closes,
        open: today <= closes,
        blocks: (req?.blocks ?? []).filter((k) => keys.has(k)), // a block the League removed no longer counts
        options,
        max,
        setBy: req?.by ?? null,
        off: offOf(day),
        offBy: x.offs[day]?.by ?? null,
      });
    }
    const lastBracket = x.bracket_days.at(-1);
    if (entry.bracket && (!lastBracket || lastBracket >= today))
      out.push({
        programId: x.program_id,
        program: x.program,
        day: "brackets",
        bracketDays: x.bracket_days,
        games: null,
        requests: false,
        closes: x.bracket_days[0] ?? "",
        open: false,
        blocks: [],
        options,
        max,
        setBy: null,
        off: offOf("brackets"),
        offBy: x.offs.brackets?.by ?? null,
      });
  }
  return out;
}

// The team sits out one of its upcoming dates (or the Brackets), or plays it again (`out` false). Its coaches or the
// Scheduler, until that date (the Brackets: their first day). Its registration and fee stay. A date the League took it
// out of is restored only by the League.
export async function setSitOut(
  deps: Deps,
  viewer: SessionUser,
  teamId: unknown,
  programId: unknown,
  what: unknown,
  out: boolean,
): Promise<Result> {
  if (!isId(teamId) || !isId(programId) || (what !== "brackets" && !isDate(what))) return { ok: false, message: "Pick a date." };
  return withTx(deps.pool, async (q) => {
    if (!(await mayRequest(q, viewer, teamId)))
      return { ok: false as const, message: "Only the team's Head or Assistant Coach can change this." };
    await q.query("select pg_advisory_xact_lock(hashtext('sched-req:' || $1 || ':' || $2))", [teamId, what]);
    const d = ((await teamRequests(deps, viewer, teamId)) ?? []).find((x) => x.programId === programId && x.day === what);
    if (!d) return { ok: false as const, message: "The team isn't playing that date." };
    const today = easternDate(deps.now());
    const starts = what === "brackets" ? d.bracketDays[0] : (what as string);
    if (starts && starts < today) return { ok: false as const, message: "That date has passed." };
    if (out) {
      if (d.off) return { ok: true as const };
      await q.query(
        `insert into scenic_team_off (program_id, team_id, off, set_by, set_at, by_team) values ($1, $2, $3, $4, $5, true)
         on conflict do nothing`,
        [programId, teamId, what, by(viewer), deps.now()],
      );
      return { ok: true as const };
    }
    if (d.off === "league")
      return { ok: false as const, message: "The League took the team out of that date. Ask its Director of Scheduling." };
    await q.query("delete from scenic_team_off where program_id = $1 and team_id = $2 and off = $3", [programId, teamId, what]);
    return { ok: true as const };
  });
}

// Save the team's blocked blocks for one Game Day (an empty list: free all day). From the League's blocks, up to its
// limit; only while requests are open.
export async function saveRequest(
  deps: Deps,
  viewer: SessionUser,
  teamId: unknown,
  programId: unknown,
  day: unknown,
  blocks: unknown,
): Promise<Result<{ setBy: string }>> {
  if (!isId(teamId) || !isId(programId) || !isDate(day)) return { ok: false, message: "Pick a Game Day." };
  if (!Array.isArray(blocks) || blocks.some((b) => typeof b !== "string")) return { ok: false, message: "Pick from the time blocks." };
  return withTx(deps.pool, async (q) => {
    if (!(await mayRequest(q, viewer, teamId)))
      return { ok: false as const, message: "Only the team's Head or Assistant Coach can make schedule requests." };
    await q.query("select pg_advisory_xact_lock(hashtext('sched-req:' || $1 || ':' || $2))", [teamId, day]);
    const days = (await teamRequests(deps, viewer, teamId)) ?? [];
    const d = days.find((x) => x.programId === programId && x.day === day);
    if (!d || !d.requests) return { ok: false as const, message: "That Game Day doesn't take schedule requests for this team." };
    if (d.off) return { ok: false as const, message: "The team is sitting out that day." };
    if (!d.open) return { ok: false as const, message: `Requests for that day closed ${d.closes}. ${RULES_NOTE}` };
    if (blocks.some((b) => !d.options.some((x) => x.key === b))) return { ok: false as const, message: "Pick from the time blocks." };
    const list = d.options.map((b) => b.key).filter((k) => blocks.includes(k));
    if (list.length > d.max)
      return {
        ok: false as const,
        message: `Block up to ${d.max} of the ${d.options.length} time blocks; the team must be free for the others.`,
      };
    if (!list.length)
      await q.query("delete from scenic_schedule_requests where program_id = $1 and team_id = $2 and day = $3", [
        programId,
        teamId,
        day,
      ]);
    else
      await q.query(
        `insert into scenic_schedule_requests (program_id, team_id, day, blocks, set_by, set_at) values ($1, $2, $3, $4, $5, $6)
         on conflict (program_id, team_id, day) do update set blocks = excluded.blocks, set_by = excluded.set_by, set_at = excluded.set_at`,
        [programId, teamId, day, list, by(viewer), deps.now()],
      );
    return { ok: true as const, setBy: by(viewer) };
  });
}

// For the Grid: the first team (of these) whose request blocks a game then, with the blocks it hits; null if none.
export async function requestClash(
  q: Pick<Queryable, "query">,
  day: string,
  teamIds: (string | null)[],
  start: number,
  minutes: number,
): Promise<{ team: string; blocks: string[] } | null> {
  const ids = teamIds.filter((x): x is string => !!x);
  if (!ids.length) return null;
  const r = await q.query<{ name: string; blocks: string[]; settings: { blocks: Block[]; max: number } | null }>(
    `select t.name, q.blocks, ${SETTINGS_SQL("q.program_id")} as settings
       from scenic_schedule_requests q join scenic_teams t on t.id = q.team_id
      join program_game_days d on d.program_id = q.program_id and d.requests_at is not null
      join game_days g on g.id = d.game_day_id and g.day = q.day
      where q.day = $1::date and q.team_id = any($2::bigint[])`,
    [day, ids],
  );
  for (const x of r.rows) {
    const hit = blockedBy(x.blocks, start, minutes, settingsOf(x.settings).blocks);
    if (hit.length) return { team: x.name, blocks: hit };
  }
  return null;
}
