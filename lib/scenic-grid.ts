// Scenic City Scheduler: the Grid (SPEC.md section 13, step 7). For one Game Day, every gym open for Scenic City games:
// partners' courts with hours that day, and organizations' gyms marked Partner Games that day (a whole gym, once the
// organization is an approved hosting partner). Each gym's open hours split into blocks of the day's game length (its
// program's game length, 55 unless changed, or the day's override), starting when the gym opens; or, when the day's
// override sets its own start times, those times at every gym (each where a whole game fits in its hours).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { TEAM_COACHES, isScheduler } from "./scenic-programs";
import { withTx, type Queryable } from "./sql";
import { timeLabel } from "./time";
import { courtDivisionsOn } from "./scenic-courts";
import { memo, remembering } from "./request-memo";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

// starts/ends: "HH:MM" Eastern. divisions: the only divisions allowed on it (Facilities → Courts), or null: any.
export type GridCourt = { id: string; name: string; starts: string; ends: string; divisions: string[] | null };
// hostId: the partner hosting it; teams from that partner are its home teams.
export type GridGym = { key: string; name: string; host: string; hostId: string; address: string | null; courts: GridCourt[] };
export type DayGrid = {
  minutes: number; // the day's game length: its override, else its program's
  setBy: string | null; // who set the day's override
  override: boolean; // the day has its own length or start times
  breaks: SlotBreak[] | null; // Custom times: break points, each starting slots of its own length
  slots: Slot[] | null; // the slots they make (every gym), or null: blocks of the game length from each gym's opening
  programMinutes: number; // its program's game length (the first League that plays that day)
  programName: string | null;
  gyms: GridGym[];
};

export type SlotBreak = { start: string; minutes: number }; // from `start`, slots of `minutes`
export type Slot = { start: string; minutes: number };

// Custom times: games back to back from the first break point until `closes` (when the last host closes), no gaps;
// each game is as long as the latest break point at or before its start (a game that starts before a break point keeps
// the earlier length, and the next one takes the new length).
export function slotsFromBreaks(breaks: SlotBreak[], closes: string): Slot[] {
  const out: Slot[] = [];
  const sorted = [...breaks].sort((a, b) => a.start.localeCompare(b.start));
  if (!sorted.length) return out;
  for (let t = toMin(sorted[0].start); ;) {
    const len = sorted.filter((b) => toMin(b.start) <= t).at(-1)!.minutes;
    if (t + len > toMin(closes)) break;
    out.push({ start: toTime(t), minutes: len });
    t += len;
  }
  return out;
}

// A gym's game blocks that day ([start, end], "HH:MM"): the Custom times' slots where a whole game fits in the gym's
// hours, else blocks of the game length from when it opens.
export function gymBlocks(grid: Pick<DayGrid, "minutes" | "slots">, opens: string, closes: string): [string, string][] {
  if (!grid.slots) return gridBlocks(opens, closes, grid.minutes);
  return grid.slots
    .filter((x) => toMin(x.start) >= toMin(opens) && toMin(x.start) + x.minutes <= toMin(closes))
    .map((x) => [x.start, toTime(toMin(x.start) + x.minutes)]);
}

// How long a game starting then lasts: its slot's length (Custom times), else the day's game length.
export const lengthAt = (grid: Pick<DayGrid, "minutes" | "slots">, start: string) =>
  grid.slots?.find((x) => x.start === start)?.minutes ?? grid.minutes;

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Game blocks from `starts` while a whole game still fits before `ends`: [start, end] pairs, "HH:MM".
export function gridBlocks(starts: string, ends: string, minutes: number): [string, string][] {
  const out: [string, string][] = [];
  for (let m = toMin(starts); m + minutes <= toMin(ends); m += minutes) out.push([toTime(m), toTime(m + minutes)]);
  return out;
}

// The Grid for one Game Day. Admins and Directors of Scheduling only (null for anyone else, or not a Game Day).
// While a page is being built, the first Game Day asked for loads every Game Day's grid in one go and the rest come from
// that (a page shows many: the Scheduler's day cards, each with its length and grid). Saving a change reads fresh.
export async function dayGrid(deps: Deps, viewer: SessionUser, day: unknown): Promise<DayGrid | null> {
  if (!isDate(day)) return null;
  if (!("totalCount" in deps.pool) || !remembering()) return (await dayGrids(deps, viewer, [day])).get(day) ?? null;
  const all = await memo(deps.pool, `grids:${viewer.coachId}`, () => dayGrids(deps, viewer, null));
  return all.get(day) ?? null;
}

// The Grids for several Game Days at once (the schedule analysis): three queries in all, not three a day. Days that
// aren't Game Days are left out; an empty map for anyone but Admins and Directors of Scheduling.
// `days` null: every Game Day.
export async function dayGrids(deps: Deps, viewer: SessionUser, days: string[] | null): Promise<Map<string, DayGrid>> {
  const out = new Map<string, DayGrid>();
  const dates = days ? [...new Set(days.filter(isDate))] : null;
  if ((dates && !dates.length) || !(await isScheduler(deps.pool, viewer))) return out;
  const d = await deps.pool.query<Omit<DayGrid, "gyms" | "slots"> & { id: string; day: string }>(
    `select gd.id::text, to_char(gd.day, 'YYYY-MM-DD') as day, coalesce(gd.minutes_override, p.game_minutes, 55) as minutes,
            gd.override_by as "setBy", (gd.minutes_override is not null or gd.slot_breaks is not null) as override,
            gd.slot_breaks as breaks, coalesce(p.game_minutes, 55) as "programMinutes", p.name as "programName"
       from game_days gd
       left join lateral (select p.game_minutes, p.name from program_game_days pg join scenic_programs p on p.id = pg.program_id
                           where pg.game_day_id = gd.id order by p.starts_on, p.id limit 1) p on true
      where $1::date[] is null or gd.day = any($1::date[])`,
    [dates],
  );
  if (!d.rows.length) return out;
  const [rows, allowedOn] = await Promise.all([
    deps.pool.query<{
      day: string;
      gymKey: string;
      gym: string;
      host: string;
      hostId: string;
      address: string | null;
      id: string;
      court: string;
      starts: string;
      ends: string;
    }>(
      `-- Partners' own courts with hours that day (organization partners' gyms come from their Facilities, below)
       select to_char(gd.day, 'YYYY-MM-DD') as day, 'p' || g.id as "gymKey", g.name as gym, p.name as host, p.id::text as "hostId",
              g.address, c.id::text, c.name as court, to_char(h.starts, 'HH24:MI') as starts, to_char(h.ends, 'HH24:MI') as ends
         from court_hours h join game_days gd on gd.id = h.game_day_id
         join partner_courts c on c.id = h.court_id join partner_gyms g on g.id = c.gym_id
         join partners p on p.id = g.partner_id
        where h.game_day_id = any($1::bigint[]) and p.org_slug is null
       union all
       -- Organizations that are approved hosting partners: each gym marked Partner Games that day, all its courts (or the
       -- whole gym when it has none) open those hours. Practice goals (Thunder's "Goal #1", "Goal #2") are halves of one
       -- court, so a gym with only goals is one court for games.
       select to_char(a.day, 'YYYY-MM-DD'), 'o' || g.id, g.name, p.name, p.id::text, null, 'o' || g.id || '-' || coalesce(c.id::text, 'gym'),
              coalesce(c.name, 'Main'), to_char(a.starts, 'HH24:MI'), to_char(a.ends, 'HH24:MI')
         from gym_availability a join gyms g on g.id = a.gym_id left join courts c on c.gym_id = g.id and c.name !~* '^goal'
         join partners p on p.org_slug = g.org and p.approved and p.hosts_games
        where a.use = 'partner' and a.day = any($2::date[]) and g.active
       order by 1, 4, 3, 8`,
      [d.rows.map((x) => x.id), d.rows.map((x) => x.day)],
    ),
    courtDivisionsOn(deps.pool, d.rows.map((x) => x.day)),
  ]);
  for (const day0 of d.rows) {
    const allowed = allowedOn(day0.day);
    const gyms = new Map<string, GridGym>();
    for (const r of rows.rows) {
      if (r.day !== day0.day) continue;
      const g = gyms.get(r.gymKey) ?? {
        key: r.gymKey,
        name: r.gym,
        host: r.host,
        hostId: r.hostId,
        address: r.address,
        courts: [],
      };
      g.courts.push({ id: r.id, name: r.court, starts: r.starts, ends: r.ends, divisions: allowed.get(r.id) ?? null });
      gyms.set(r.gymKey, g);
    }
    // Partners' courts in number order ("Court 2" before "Court 10"); organizations' courts in the order they were added
    // in their Facilities (e.g. Main, then Aux).
    for (const g of gyms.values())
      g.courts.sort((a, b) =>
        g.key.startsWith("o")
          ? Number(a.id.split("-")[1]) - Number(b.id.split("-")[1])
          : a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    const { id: _id, day: _day, ...rest } = day0;
    void _id;
    void _day;
    // Custom times run until the last host closes.
    const closes = [...gyms.values()].flatMap((g) => g.courts).reduce((x, c) => (c.ends > x ? c.ends : x), "00:00");
    const slots = rest.breaks ? slotsFromBreaks(rest.breaks, closes) : null;
    out.set(day0.day, { ...rest, slots, gyms: [...gyms.values()] });
  }
  return out;
}

const isMinutes = (m: unknown): m is number => typeof m === "number" && Number.isInteger(m) && m >= 20 && m <= 180;
const MINUTES_MESSAGE = "Game length must be 20 to 180 minutes.";
const schedulerOnly = { ok: false as const, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
type Retimed = Result<{ moved: number; off: string[] }>;

// Change a Game Day's times (its override, or its program's game length) and move its placed games with their blocks:
// each keeps its block number at its gym (the 3rd game of the day stays the 3rd) at the new time. A game with no such
// block any more, that no longer fits its court's hours, or that would overlap another game of one of its teams comes
// off the grid; their names come back to say so. Admins and Directors of Scheduling only.
async function retime(deps: Deps, viewer: SessionUser, day: unknown, change: (q: Queryable) => Promise<void>): Promise<Retimed> {
  if (!isDate(day)) return { ok: false, message: "Pick a Game Day." };
  const before = await dayGrid(deps, viewer, day); // null: not a Scheduler, or not a Game Day
  if (!before) {
    if (!(await isScheduler(deps.pool, viewer))) return schedulerOnly;
    return { ok: false, message: "That isn't a Game Day." };
  }
  const by = `${viewer.firstName} ${viewer.lastName}`;
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-grid:' || $1))", [day]);
    await change(q);
    const after = (await dayGrid({ ...deps, pool: q as unknown as Pool }, viewer, day))!;
    return { ok: true as const, ...(await rePlace(q, day, before, after, by, deps.now())) };
  });
}

// Each court's gym and that gym's blocks, for one version of the day's grid.
function blocksByCourt(grid: DayGrid) {
  return new Map(
    grid.gyms.flatMap((g) => {
      const opens = g.courts.reduce((x, c) => (c.starts < x ? c.starts : x), "23:59");
      const closes = g.courts.reduce((x, c) => (c.ends > x ? c.ends : x), "00:00");
      const all = gymBlocks(grid, opens, closes);
      const blocks = all.map(([b]) => toMin(b));
      const lengths = all.map(([b, e]) => toMin(e) - toMin(b));
      return g.courts.map(
        (c) => [c.id, { opens: toMin(opens), starts: toMin(c.starts), ends: toMin(c.ends), blocks, lengths }] as const,
      );
    }),
  );
}

async function rePlace(q: Queryable, day: string, before: DayGrid, after: DayGrid, by: string, now: Date) {
  const old = blocksByCourt(before);
  const neu = blocksByCourt(after);
  const placed = await q.query<{ id: string; court: string; starts: string; a: string; b: string | null; name: string }>(
    `select m.id::text, m.court_key as court, to_char(m.starts, 'HH24:MI') as starts, m.team_a::text as a, m.team_b::text as b,
            ta.name || ' vs ' || coalesce(tb.name, 'TBD') as name
       from scenic_matchups m join scenic_teams ta on ta.id = m.team_a left join scenic_teams tb on tb.id = m.team_b
      where m.day = $1::date and m.court_key is not null
      order by m.starts, m.id`,
    [day],
  );
  // New times, block by block; then games that overlap a game of the same team (earlier ones kept) come off.
  const kept: { id: string; court: string; start: number; end: number; a: string; b: string | null }[] = [];
  const off: string[] = [];
  const touched: string[] = [];
  for (const g of placed.rows) {
    const o = old.get(g.court);
    const c = neu.get(g.court);
    if (!o || !c) continue; // the court isn't open that day any more: leave it as it was
    touched.push(g.id);
    const at = toMin(g.starts);
    const i = o.blocks.indexOf(at);
    const block = i >= 0 ? i : Math.max(0, Math.round((at - o.opens) / before.minutes));
    const start = c.blocks[block];
    const end = start + (c.lengths[block] ?? after.minutes);
    const clash =
      start !== undefined &&
      kept.some(
        (k) =>
          (k.court === g.court && k.start === start) ||
          ([k.a, k.b].some((t) => t !== null && (t === g.a || t === g.b)) && k.start < end && start < k.end),
      );
    if (start === undefined || start < c.starts || end > c.ends || clash) off.push(g.name);
    else kept.push({ id: g.id, court: g.court, start, end, a: g.a, b: g.b });
  }
  await q.query("update scenic_matchups set court_key = null, starts = null where id = any($1::bigint[])", [touched]);
  for (const k of kept)
    await q.query("update scenic_matchups set court_key = $2, starts = $3::time where id = $1", [k.id, k.court, toTime(k.start)]);
  if (off.length)
    await q.query(
      "update scenic_matchups set placed_by = $2, placed_at = $3 where id = any($1::bigint[]) and court_key is null",
      [touched, by, now],
    );
  return { moved: kept.length, off };
}

// The day's override: either its own game length (slots every game length from each gym's opening) or Custom times,
// break points (1–20, each a start time and a slot length of 20–180 minutes) that make the slots for every gym. Each
// break point must fall within the hosts' availability: a whole slot fits at some court open that day. Placed games
// move with their blocks (retime).
export async function setDayOverride(
  deps: Deps,
  viewer: SessionUser,
  day: unknown,
  input: { minutes?: unknown; breaks?: unknown },
): Promise<Retimed> {
  let breaks: SlotBreak[] | null = null;
  let m: unknown = typeof input?.minutes === "string" ? Number(input.minutes) : input?.minutes;
  if (input?.breaks !== null && input?.breaks !== undefined) {
    const list = input.breaks;
    if (
      !Array.isArray(list) ||
      !list.every((b) => b && typeof b === "object" && isTime((b as SlotBreak).start) && isMinutes((b as SlotBreak).minutes))
    )
      return { ok: false, message: "Each break point needs a time and a slot length of 20 to 180 minutes." };
    breaks = (list as SlotBreak[])
      .map((b) => ({ start: b.start, minutes: b.minutes }))
      .sort((a, b) => a.start.localeCompare(b.start));
    if (!breaks.length || breaks.length > 20) return { ok: false, message: "Give 1 to 20 break points." };
    if (new Set(breaks.map((b) => b.start)).size !== breaks.length)
      return { ok: false, message: "Two break points have the same time." };
    m = breaks[0].minutes; // the day's game length: the first break point's
  }
  if (!isMinutes(m)) return { ok: false, message: MINUTES_MESSAGE };
  if (breaks) {
    const grid = await dayGrid(deps, viewer, day);
    const courts = grid?.gyms.flatMap((g) => g.courts) ?? [];
    if (grid && !courts.length) return { ok: false, message: "No hosts are open that day yet, so there are no times to set." };
    const outside = breaks.filter(
      (b) => !courts.some((c) => toMin(c.starts) <= toMin(b.start) && toMin(b.start) + b.minutes <= toMin(c.ends)),
    );
    if (grid && outside.length)
      return {
        ok: false,
        message: `No host is open for a whole slot at ${outside.map((b) => `${timeLabel(b.start)} (${b.minutes} min)`).join(", ")}.`,
      };
  }
  const by = `${viewer.firstName} ${viewer.lastName}`;
  return retime(deps, viewer, day, async (q) => {
    await q.query(
      "update game_days set minutes_override = $2, slot_breaks = $3::jsonb, slot_times = null, override_by = $4 where day = $1::date",
      [day, m, breaks ? JSON.stringify(breaks) : null, by],
    );
  });
}

// Only the day's game length (its Custom times, if any, stay).
export async function setGameLength(deps: Deps, viewer: SessionUser, day: unknown, minutes: unknown): Promise<Retimed> {
  const m = typeof minutes === "string" ? Number(minutes) : minutes;
  if (!isMinutes(m)) return { ok: false, message: MINUTES_MESSAGE };
  const by = `${viewer.firstName} ${viewer.lastName}`;
  return retime(deps, viewer, day, async (q) => {
    await q.query("update game_days set minutes_override = $2, override_by = $3 where day = $1::date", [day, m, by]);
  });
}

// Cancel the day's override: back to its program's game length, blocks from each gym's opening.
export async function clearDayOverride(deps: Deps, viewer: SessionUser, day: unknown): Promise<Retimed> {
  return retime(deps, viewer, day, async (q) => {
    await q.query(
      "update game_days set minutes_override = null, slot_breaks = null, slot_times = null, override_by = null where day = $1::date",
      [day],
    );
  });
}

// A program's game length (20–180 minutes), for each of its Game Days without an override; placed games on those days
// move with their blocks. Admins and Directors of Scheduling only.
export async function setProgramGameLength(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  minutes: unknown,
): Promise<Retimed> {
  const m = typeof minutes === "string" ? Number(minutes) : minutes;
  if (typeof programId !== "string" || !/^\d{1,18}$/.test(programId)) return { ok: false, message: "Pick a program." };
  if (!isMinutes(m)) return { ok: false, message: MINUTES_MESSAGE };
  if (!(await isScheduler(deps.pool, viewer))) return schedulerOnly;
  const days = await deps.pool.query<{ day: string }>(
    `select gd.day::text from program_game_days pg join game_days gd on gd.id = pg.game_day_id
      where pg.program_id = $1 order by gd.day`,
    [programId],
  );
  const exists = await deps.pool.query("select 1 from scenic_programs where id = $1", [programId]);
  if (!exists.rowCount) return { ok: false, message: "That program wasn't found." };
  const by = `${viewer.firstName} ${viewer.lastName}`;
  let moved = 0;
  const off: string[] = [];
  let first = true;
  // One day at a time (each locked while its games move); the program changes with the first.
  for (const { day } of days.rows) {
    const r = await retime(deps, viewer, day, async (q) => {
      if (first)
        await q.query("update scenic_programs set game_minutes = $2, game_minutes_set_by = $3 where id = $1", [programId, m, by]);
    });
    first = false;
    if (!r.ok) return r;
    moved += r.moved;
    off.push(...r.off);
  }
  if (first)
    await deps.pool.query("update scenic_programs set game_minutes = $2, game_minutes_set_by = $3 where id = $1", [
      programId,
      m,
      by,
    ]);
  return { ok: true, moved, off };
}

const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isMatchupId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

// Place a matchup in a game slot (a court open that Game Day, at a start time when a whole game fits in the court's
// hours), move it, or take it off the grid (`slot` null). Admins and Directors of Scheduling only. The slot must be
// free, and neither team can be playing another game then (games overlap within the day's game length).
export async function placeGame(
  deps: Deps,
  viewer: SessionUser,
  matchupId: unknown,
  slot: { court: unknown; starts: unknown } | null,
): Promise<Result> {
  if (!isMatchupId(matchupId)) return { ok: false, message: "That game wasn't found." };
  if (
    slot &&
    (typeof slot.court !== "string" || !/^(\d{1,18}|o\d{1,18}-(\d{1,18}|gym))$/.test(slot.court) || !isTime(slot.starts))
  )
    return { ok: false, message: "Pick a game slot." };
  if (!(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
  const m = await deps.pool.query<{ day: string; a: string; b: string | null; division: string }>(
    `select day::text, team_a::text as a, team_b::text as b, division_id::text as division
       from scenic_matchups where id = $1`,
    [matchupId],
  );
  const game = m.rows[0];
  if (!game) return { ok: false, message: "That game was changed. Reload the page." };
  const by = `${viewer.firstName} ${viewer.lastName}`;
  if (!slot) {
    await deps.pool.query(
      "update scenic_matchups set court_key = null, starts = null, placed_by = $2, placed_at = $3 where id = $1",
      [matchupId, by, deps.now()],
    );
    return { ok: true };
  }
  const grid = await dayGrid(deps, viewer, game.day);
  const court = grid?.gyms.flatMap((g) => g.courts.map((c) => ({ ...c, gym: g.name }))).find((c) => c.id === slot.court);
  if (!grid || !court) return { ok: false, message: "That court isn't open for games that day." };
  if (court.divisions && !court.divisions.includes(game.division))
    return { ok: false, message: `${court.gym} ${court.name} isn't approved for this division (Facilities → Courts).` };
  const starts = slot.starts as string;
  const start = toMin(starts);
  // The day's Custom times (its override): games start only at its slots, each lasting its slot's length.
  if (grid.slots && !grid.slots.some((x) => x.start === starts))
    return { ok: false, message: "That isn't one of this day's time slots (the day's override sets them)." };
  const len = lengthAt(grid, starts);
  // Each other game lasts its own slot's length ($lens: start → minutes; else the day's length).
  const lens = JSON.stringify(Object.fromEntries((grid.slots ?? []).map((x) => [x.start, x.minutes])));
  if (start < toMin(court.starts) || start + len > toMin(court.ends))
    return {
      ok: false,
      message: `${court.gym} ${court.name} is open ${timeLabel(court.starts)}–${timeLabel(court.ends)}; a game doesn't fit then.`,
    };
  return withTx(deps.pool, async (q) => {
    // One placement at a time per Game Day, so two Schedulers can't fill the same slot.
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-grid:' || $1))", [game.day]);
    const clash = await q.query<{ taken: boolean; name: string | null }>(
      `select m.court_key = $3 and m.starts = $4::time as taken,
              (select t.name from scenic_teams t where t.id in (m.team_a, m.team_b) and t.id in ($5::bigint, $6::bigint) limit 1) as name
         from scenic_matchups m
        where m.day = $1::date and m.id <> $2 and m.court_key is not null
          and ((m.court_key = $3 and m.starts = $4::time)
               or ((m.team_a in ($5::bigint, $6::bigint) or m.team_b in ($5::bigint, $6::bigint))
                   and m.starts < $4::time + make_interval(mins => $7)
                   and $4::time < m.starts + make_interval(mins => coalesce(($8::jsonb ->> to_char(m.starts, 'HH24:MI'))::int, $9))))
        order by 1 desc limit 1`,
      [game.day, matchupId, slot.court, starts, game.a, game.b, len, lens, grid.minutes],
    );
    const c = clash.rows[0];
    if (c?.taken) return { ok: false as const, message: "That slot already has a game. Move that game first." };
    if (c) return { ok: false as const, message: `${c.name} is already playing then.` };
    // No one coaches two games at once: a Head or Assistant Coach of either team with another game that close.
    const coach = await q.query<{ name: string; key: string }>(
      `select x.c->>'name' as name, x.c->>'key' as key
         from scenic_matchups m
         join scenic_teams t on t.id in (m.team_a, m.team_b)
         cross join lateral json_array_elements(${TEAM_COACHES}) x(c)
        where m.day = $1::date and m.id <> $2 and m.court_key is not null
          and m.starts < $3::time + make_interval(mins => $6)
          and $3::time < m.starts + make_interval(mins => coalesce(($7::jsonb ->> to_char(m.starts, 'HH24:MI'))::int, $8))
          and x.c->>'key' in (select y.c->>'key' from scenic_teams t cross join lateral json_array_elements(${TEAM_COACHES}) y(c)
                               where t.id in ($4::bigint, $5::bigint))
        limit 1`,
      [game.day, matchupId, starts, game.a, game.b, len, lens, grid.minutes],
    );
    if (coach.rows[0])
      return {
        ok: false as const,
        message: coach.rows[0].key.startsWith("b:")
          ? `A team bound to this game (${coach.rows[0].name}) already plays then: bound teams never play at the same time.`
          : `${coach.rows[0].name} already coaches a game then (one coach, one game at a time).`,
      };
    await q.query("update scenic_matchups set court_key = $2, starts = $3::time, placed_by = $4, placed_at = $5 where id = $1", [
      matchupId,
      slot.court,
      starts,
      by,
      deps.now(),
    ]);
    return { ok: true as const };
  });
}

// A Game Day's game length and who set it (for the day's header). Admins and Directors of Scheduling only.
// The day's times for its gear: game length (and whose), override, time slots, its program's length, and the block
// start times in use (every gym's, in order). Admins and Directors of Scheduling only.
export async function gameLength(
  deps: Deps,
  viewer: SessionUser,
  day: unknown,
): Promise<(Omit<DayGrid, "gyms"> & { opens: string | null; closes: string | null }) | null> {
  const g = await dayGrid(deps, viewer, day);
  if (!g) return null;
  const { gyms, ...rest } = g;
  // The hosts' hours that day (first open to last close), and one list of start times to begin Custom times from: the
  // override's, else a game length apart across those hours.
  const courts = gyms.flatMap((x) => x.courts);
  const opens = courts.length ? courts.reduce((x, c) => (c.starts < x ? c.starts : x), "23:59") : null;
  const closes = courts.length ? courts.reduce((x, c) => (c.ends > x ? c.ends : x), "00:00") : null;
  return { ...rest, opens, closes };
}

// A program's game length and who set it (the program gear). Admins and Directors of Scheduling only.
export async function programGameLength(
  deps: Deps,
  viewer: SessionUser,
  programId: string,
): Promise<{ minutes: number; setBy: string | null } | null> {
  if (!/^\d{1,18}$/.test(programId) || !(await isScheduler(deps.pool, viewer))) return null;
  const r = await deps.pool.query<{ minutes: number; setBy: string | null }>(
    `select game_minutes as minutes, game_minutes_set_by as "setBy" from scenic_programs where id = $1`,
    [programId],
  );
  return r.rows[0] ?? null;
}
