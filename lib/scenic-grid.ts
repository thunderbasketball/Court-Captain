// Scenic City Scheduler: the Grid (SPEC.md section 13, step 7). For one Game Day, every gym open for Scenic City games:
// partners' courts with hours that day, and organizations' gyms marked Partner Games that day (a whole gym, once the
// organization is an approved hosting partner). Each gym's open hours split into blocks of the day's game length
// (55 minutes unless changed), starting when the gym opens.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { TEAM_COACHES, isScheduler } from "./scenic-programs";
import { withTx } from "./sql";
import { timeLabel } from "./time";
import { courtDivisions } from "./scenic-courts";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

// starts/ends: "HH:MM" Eastern. divisions: the only divisions allowed on it (Facilities → Courts), or null: any.
export type GridCourt = { id: string; name: string; starts: string; ends: string; divisions: string[] | null };
// hostId: the partner hosting it; teams from that partner are its home teams.
export type GridGym = { key: string; name: string; host: string; hostId: string; address: string | null; courts: GridCourt[] };
export type DayGrid = { minutes: number; setBy: string | null; gyms: GridGym[] };

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
export async function dayGrid(deps: Deps, viewer: SessionUser, day: unknown): Promise<DayGrid | null> {
  if (!isDate(day) || !(await isScheduler(deps.pool, viewer))) return null;
  const d = await deps.pool.query<{ id: string; minutes: number; setBy: string | null }>(
    `select id::text, game_minutes as minutes, game_minutes_set_by as "setBy" from game_days where day = $1::date`,
    [day],
  );
  if (!d.rows[0]) return null;
  const rows = await deps.pool.query<{
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
     select 'p' || g.id as "gymKey", g.name as gym, p.name as host, p.id::text as "hostId", g.address, c.id::text, c.name as court,
            to_char(h.starts, 'HH24:MI') as starts, to_char(h.ends, 'HH24:MI') as ends
       from court_hours h join partner_courts c on c.id = h.court_id join partner_gyms g on g.id = c.gym_id
       join partners p on p.id = g.partner_id
      where h.game_day_id = $1 and p.org_slug is null
     union all
     -- Organizations that are approved hosting partners: each gym marked Partner Games that day, all its courts (or the
     -- whole gym when it has none) open those hours. Practice goals (Thunder's "Goal #1", "Goal #2") are halves of one
     -- court, so a gym with only goals is one court for games.
     select 'o' || g.id, g.name, p.name, p.id::text, null, 'o' || g.id || '-' || coalesce(c.id::text, 'gym'),
            coalesce(c.name, 'Main'), to_char(a.starts, 'HH24:MI'), to_char(a.ends, 'HH24:MI')
       from gym_availability a join gyms g on g.id = a.gym_id left join courts c on c.gym_id = g.id and c.name !~* '^goal'
       join partners p on p.org_slug = g.org and p.approved and p.hosts_games
      where a.use = 'partner' and a.day = $2::date and g.active
     order by 3, 2, 7`,
    [d.rows[0].id, day],
  );
  const allowed = await courtDivisions(deps.pool, day);
  const gyms = new Map<string, GridGym>();
  for (const r of rows.rows) {
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
  return { minutes: d.rows[0].minutes, setBy: d.rows[0].setBy, gyms: [...gyms.values()] };
}

// Set a Game Day's game length (20–180 minutes). Admins and Directors of Scheduling only; who set it is recorded.
// Placed games move with the blocks: each keeps its block number at its gym (the 3rd game of the day stays the 3rd),
// at the new times. A game that no longer fits in its court's hours, or that would overlap another game of one of its
// teams, comes off the grid; their names come back to say so.
export async function setGameLength(
  deps: Deps,
  viewer: SessionUser,
  day: unknown,
  minutes: unknown,
): Promise<Result<{ moved: number; off: string[] }>> {
  const m = typeof minutes === "string" ? Number(minutes) : minutes;
  if (!isDate(day)) return { ok: false, message: "Pick a Game Day." };
  if (typeof m !== "number" || !Number.isInteger(m) || m < 20 || m > 180)
    return { ok: false, message: "Game length must be 20 to 180 minutes." };
  const grid = await dayGrid(deps, viewer, day); // null: not a Scheduler, or not a Game Day
  if (!grid) {
    if (!(await isScheduler(deps.pool, viewer)))
      return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
    return { ok: false, message: "That isn't a Game Day." };
  }
  // Each court's gym opening time (blocks start there) and hours.
  const courts = new Map(
    grid.gyms.flatMap((g) => {
      const opens = g.courts.reduce((x, c) => Math.min(x, toMin(c.starts)), 24 * 60);
      return g.courts.map((c) => [c.id, { opens, starts: toMin(c.starts), ends: toMin(c.ends) }] as const);
    }),
  );
  const by = `${viewer.firstName} ${viewer.lastName}`;
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-grid:' || $1))", [day]);
    const old = (await q.query<{ m: number }>("select game_minutes as m from game_days where day = $1::date for update", [day]))
      .rows[0].m;
    await q.query("update game_days set game_minutes = $2, game_minutes_set_by = $3 where day = $1::date", [day, m, by]);
    const placed = await q.query<{ id: string; court: string; starts: string; a: string; b: string | null; name: string }>(
      `select m.id::text, m.court_key as court, to_char(m.starts, 'HH24:MI') as starts, m.team_a::text as a, m.team_b::text as b,
              ta.name || ' vs ' || coalesce(tb.name, 'TBD') as name
         from scenic_matchups m join scenic_teams ta on ta.id = m.team_a left join scenic_teams tb on tb.id = m.team_b
        where m.day = $1::date and m.court_key is not null
        order by m.starts, m.id`,
      [day],
    );
    // New times, block by block; then games that overlap a game of the same team (earlier ones kept) come off.
    const kept: { id: string; court: string; start: number; a: string; b: string | null }[] = [];
    const off: string[] = [];
    for (const g of placed.rows) {
      const c = courts.get(g.court);
      if (!c) continue; // the court isn't open that day any more: leave it as it was
      const block = Math.max(0, Math.round((toMin(g.starts) - c.opens) / old));
      const start = c.opens + block * m;
      const clash = kept.some(
        (k) =>
          (k.court === g.court && k.start === start) ||
          ([k.a, k.b].some((t) => t !== null && (t === g.a || t === g.b)) && Math.abs(k.start - start) < m),
      );
      if (start < c.starts || start + m > c.ends || clash) off.push(g.name);
      else kept.push({ id: g.id, court: g.court, start, a: g.a, b: g.b });
    }
    const ids = placed.rows.filter((g) => courts.has(g.court)).map((g) => g.id);
    await q.query("update scenic_matchups set court_key = null, starts = null where id = any($1::bigint[])", [ids]);
    for (const k of kept)
      await q.query("update scenic_matchups set court_key = $2, starts = $3::time where id = $1", [
        k.id,
        k.court,
        toTime(k.start),
      ]);
    if (off.length)
      await q.query(
        "update scenic_matchups set placed_by = $2, placed_at = $3 where id = any($1::bigint[]) and court_key is null",
        [ids, by, deps.now()],
      );
    return { ok: true as const, moved: kept.length, off };
  });
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
  if (start < toMin(court.starts) || start + grid.minutes > toMin(court.ends))
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
                   and abs(extract(epoch from (m.starts - $4::time)) / 60) < $7))
        order by 1 desc limit 1`,
      [game.day, matchupId, slot.court, starts, game.a, game.b, grid.minutes],
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
          and abs(extract(epoch from (m.starts - $3::time)) / 60) < $6
          and x.c->>'key' in (select y.c->>'key' from scenic_teams t cross join lateral json_array_elements(${TEAM_COACHES}) y(c)
                               where t.id in ($4::bigint, $5::bigint))
        limit 1`,
      [game.day, matchupId, starts, game.a, game.b, grid.minutes],
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
export async function gameLength(
  deps: Deps,
  viewer: SessionUser,
  day: unknown,
): Promise<{ minutes: number; setBy: string | null } | null> {
  if (!isDate(day) || !(await isScheduler(deps.pool, viewer))) return null;
  const r = await deps.pool.query<{ minutes: number; setBy: string | null }>(
    `select game_minutes as minutes, game_minutes_set_by as "setBy" from game_days where day = $1::date`,
    [day],
  );
  return r.rows[0] ?? null;
}
