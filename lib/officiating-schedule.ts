// Scheduling officials (SPEC.md section 14, step 4c-4): an Officials Group's Admins and Officials Assigners put its
// officials on the games organizations scheduled with it, by dragging them into each game's 2 referee spots: scrimmages
// that picked the group, and League games placed on the Scheduler's Grid at gyms the group officiates (gym_officials).
// Both come from the `officiated_games` view, each named by a key ('s12' a scrimmage, 'm34' a League game). Shown as a
// card per day with games, a card per gym inside. Never a Recruit; never one official on two games at once (any
// group's); a game that has started stays as it is. Checked here, on the server, in a transaction.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { canOfficiate, type OfficialLevel } from "./official-levels";
import { managesOfficials } from "./officials";
import { withTx } from "./sql";
import { TZ } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };

export const SPOTS = [1, 2] as const;

export type BoardOfficial = { id: string; first: string; last: string; level: OfficialLevel | null };
export type Answer = "yes" | "no" | null; // the official's ✓ / ✗ (null: not answered yet)
export type BoardSpot = { position: number; official: { id: string; name: string } | null; assignedBy: string | null; answer: Answer };
export type BoardGame = {
  id: string; // the game's key: 's12' (a scrimmage) or 'm34' (a League game)
  kind: "Scrimmage" | "Exhibition" | "League"; // Scrimmages and Exhibitions are tagged on the board
  orgName: string;
  home: string;
  away: string;
  start: string; // ISO
  end: string;
  started: boolean;
  spots: BoardSpot[];
};
export type BoardGym = { key: string; place: string; address: string | null; orgName: string; games: BoardGame[]; open: number };
export type BoardDay = { date: string; gyms: BoardGym[]; games: number; open: number };
// Each official's games (this group's and any other's), for "already on a game then".
export type BusyTime = { gameId: string; start: string; end: string };
export type OfficialsBoard = { officials: BoardOfficial[]; days: BoardDay[]; busy: Record<string, BusyTime[]>; open: number };

// An official's spots that count: on a game still in the view, for the group that put them there (a game that changed
// group, or a League game moved off the gym's group, no longer counts).
const LIVE = `game_officials x join officiated_games g on g.key = x.game_key and g.officials_org = x.officials_org`;

// The board: the group's officials who can be scheduled (not Recruits), by last name; its coming games by day and gym.
// Null for anyone who doesn't schedule its officials.
export async function officialsBoard(deps: Deps, viewer: SessionUser, officialsOrg: string): Promise<OfficialsBoard | null> {
  if (!(await managesOfficials(deps.pool, viewer, officialsOrg))) return null;
  const [officials, games] = await Promise.all([
    deps.pool.query<BoardOfficial>(
      `select u.coach_id as id, u.first_name as first, u.last_name as last, o.level
         from org_officials o join users u on u.coach_id = o.coach_id
        where o.org = $1 and u.active order by lower(u.last_name), lower(u.first_name)`,
      [officialsOrg],
    ),
    deps.pool.query<{
      key: string;
      kind: BoardGame["kind"];
      day: string;
      gym: string;
      place: string;
      address: string | null;
      org_name: string;
      home: string;
      away: string;
      starts_at: Date;
      minutes: number;
      spots: { position: number; id: string; name: string; by: string; answer: Answer }[];
    }>(
      `select g.key, g.kind, to_char(g.starts_at at time zone $3, 'YYYY-MM-DD') as day, g.gym, g.place, g.address,
              o.name as org_name, g.home, g.away, g.starts_at, g.minutes,
              coalesce((select json_agg(json_build_object('position', x.position, 'id', x.coach_id,
                                                          'name', u.first_name || ' ' || u.last_name, 'by', x.assigned_by,
                                                          'answer', x.response))
                          from game_officials x join users u on u.coach_id = x.coach_id
                         where x.game_key = g.key and x.officials_org = g.officials_org), '[]') as spots
         from officiated_games g join organizations o on o.slug = g.org
        where g.officials_org = $1 and g.starts_at + make_interval(mins => g.minutes) > $2
        order by g.starts_at, g.place, g.key`,
      [officialsOrg, deps.now(), TZ],
    ),
  ]);
  const ids = officials.rows.map((o) => o.id);
  const busy: Record<string, BusyTime[]> = {};
  if (ids.length) {
    const b = await deps.pool.query<{ coach_id: string; key: string; starts_at: Date; minutes: number }>(
      `select x.coach_id, g.key, g.starts_at, g.minutes from ${LIVE}
        where x.coach_id = any($1) and g.starts_at + make_interval(mins => g.minutes) > $2`,
      [ids, deps.now()],
    );
    for (const r of b.rows)
      (busy[r.coach_id] ??= []).push({
        gameId: r.key,
        start: r.starts_at.toISOString(),
        end: new Date(r.starts_at.getTime() + r.minutes * 60_000).toISOString(),
      });
  }
  const days = new Map<string, Map<string, BoardGym>>();
  const now = deps.now().getTime();
  for (const r of games.rows) {
    const gyms = days.get(r.day) ?? days.set(r.day, new Map()).get(r.day)!;
    const gym =
      gyms.get(r.gym) ??
      gyms.set(r.gym, { key: r.gym, place: r.place, address: r.address, orgName: r.org_name, games: [], open: 0 }).get(r.gym)!;
    const spots = SPOTS.map((position) => {
      const x = r.spots.find((y) => y.position === position);
      return { position, official: x ? { id: x.id, name: x.name } : null, assignedBy: x?.by ?? null, answer: x?.answer ?? null };
    });
    gym.games.push({
      id: r.key,
      kind: r.kind,
      orgName: r.org_name,
      home: r.home,
      away: r.away,
      start: r.starts_at.toISOString(),
      end: new Date(r.starts_at.getTime() + r.minutes * 60_000).toISOString(),
      started: r.starts_at.getTime() <= now,
      spots,
    });
    gym.open += spots.filter((x) => !x.official).length;
  }
  const out: BoardDay[] = [...days].map(([date, gyms]) => {
    const list = [...gyms.values()];
    return { date, gyms: list, games: list.reduce((n, g) => n + g.games.length, 0), open: list.reduce((n, g) => n + g.open, 0) };
  });
  return {
    officials: officials.rows.filter((o) => canOfficiate(o.level)),
    days: out,
    busy,
    open: out.reduce((n, d) => n + d.open, 0),
  };
}

const GAME = /^[sm]\d{1,18}$/;
const COACH = /^\d{7}$/;
const isSpot = (v: unknown) => v === 1 || v === 2;
// A game key's own column and id.
const column = (key: string) => (key[0] === "s" ? "scrimmage_id" : "matchup_id");

// One game, read with a lock on its key (two Assigners at once wait for each other).
async function lockGame(q: PoolClient, key: string, officialsOrg: string) {
  await q.query("select pg_advisory_xact_lock(hashtext('game:' || $1))", [key]);
  return (
    await q.query<{ key: string; starts_at: Date; minutes: number }>(
      "select key, starts_at, minutes from officiated_games where key = $1 and officials_org = $2",
      [key, officialsOrg],
    )
  ).rows[0];
}

// Put an official in a game's spot (taking the place of whoever was there), move them there from another spot (`from`),
// or clear the spot (`officialId` null).
export async function assignOfficial(
  deps: Deps,
  viewer: SessionUser,
  officialsOrg: unknown,
  input: { gameId: unknown; position: unknown; officialId: unknown; from?: { gameId: unknown; position: unknown } | null },
): Promise<Result> {
  if (typeof officialsOrg !== "string" || !(await managesOfficials(deps.pool, viewer, officialsOrg)))
    return { ok: false, message: "Only an Admin or Officials Assigner can schedule officials." };
  const { position, officialId, from } = input;
  const gameId = String(input.gameId ?? "");
  if (!GAME.test(gameId) || !isSpot(position)) return { ok: false, message: "That game wasn't found." };
  if (officialId !== null && !COACH.test(String(officialId ?? ""))) return { ok: false, message: "Pick one of your officials." };
  const fromId = from ? String(from.gameId ?? "") : null;
  if (from && (!GAME.test(fromId!) || !isSpot(from.position))) return { ok: false, message: "That game wasn't found." };
  const by = `${viewer.firstName} ${viewer.lastName}`;
  return withTx(deps.pool, async (q) => {
    // The games involved, locked (in key order); each must be this group's and not started.
    const keys = [...new Set([gameId, ...(fromId ? [fromId] : [])])].sort();
    const games = [];
    for (const k of keys) games.push(await lockGame(q, k, officialsOrg));
    const game = games[keys.indexOf(gameId)];
    if (games.some((g) => !g)) return { ok: false as const, message: "That game wasn't found." };
    if (games.some((g) => g.starts_at.getTime() <= deps.now().getTime()))
      return { ok: false as const, message: "That game has started; its officials stay as they are." };
    if (officialId === null) {
      await q.query("delete from game_officials where game_key = $1 and position = $2", [gameId, position]);
      return { ok: true as const };
    }
    await q.query("select pg_advisory_xact_lock(hashtext('official:' || $1))", [officialId]);
    const o = (
      await q.query<{ name: string; level: OfficialLevel | null }>(
        `select u.first_name || ' ' || u.last_name as name, o.level from org_officials o join users u on u.coach_id = o.coach_id
          where o.org = $1 and o.coach_id = $2 and u.active`,
        [officialsOrg, officialId],
      )
    ).rows[0];
    if (!o) return { ok: false as const, message: "Pick one of your officials." };
    if (!canOfficiate(o.level)) return { ok: false as const, message: `${o.name} is a Recruit; Recruits can't be scheduled to officiate games.` };
    const clash = (
      await q.query<{ label: string; same: boolean }>(
        `select to_char(g.starts_at at time zone $4, 'FMHH12:MI AM') || ' at ' || g.place as label, g.key = $2 as same
           from ${LIVE}
          where x.coach_id = $1 and not coalesce(x.game_key = $6 and x.position = $7::smallint, false) -- the spot they move from
            and (g.key = $2 or (g.starts_at < $3::timestamptz + make_interval(mins => $5)
                                and $3::timestamptz < g.starts_at + make_interval(mins => g.minutes)))
          limit 1`,
        [officialId, gameId, game.starts_at, TZ, game.minutes, fromId, from ? from.position : null],
      )
    ).rows[0];
    if (clash)
      return {
        ok: false as const,
        message: clash.same ? `${o.name} is already on this game.` : `${o.name} is already on a game then (${clash.label}).`,
      };
    // Moving within the same game keeps their answer (same game, same time); anywhere else asks again.
    const kept = fromId
      ? (
          await q.query<{ response: string | null; responded_at: Date | null }>(
            "delete from game_officials where game_key = $1 and position = $2 and coach_id = $3 returning response, responded_at",
            [fromId, from!.position, officialId],
          )
        ).rows[0]
      : undefined;
    const keep = kept && fromId === gameId ? kept : null;
    await q.query("delete from game_officials where game_key = $1 and position = $2", [gameId, position]);
    await q.query(
      `insert into game_officials (${column(gameId)}, position, officials_org, coach_id, assigned_by, assigned_at, response, responded_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [gameId.slice(1), position, officialsOrg, officialId, by, deps.now(), keep?.response ?? null, keep?.responded_at ?? null],
    );
    return { ok: true as const };
  });
}

// Take one official off several games at once (✕ on a run of games in a row in one gym). Games that have started stay.
export async function removeOfficialFrom(
  deps: Deps,
  viewer: SessionUser,
  officialsOrg: unknown,
  officialId: unknown,
  gameIds: unknown,
): Promise<{ ok: true; removed: number } | { ok: false; message: string }> {
  if (typeof officialsOrg !== "string" || !(await managesOfficials(deps.pool, viewer, officialsOrg)))
    return { ok: false, message: "Only an Admin or Officials Assigner can schedule officials." };
  if (!COACH.test(String(officialId ?? "")) || !Array.isArray(gameIds) || !gameIds.length || gameIds.length > 50 || !gameIds.every((g) => GAME.test(String(g))))
    return { ok: false, message: "That game wasn't found." };
  return withTx(deps.pool, async (q) => {
    const r = await q.query(
      `delete from game_officials x using officiated_games g
        where g.key = x.game_key and x.coach_id = $1 and x.game_key = any($2::text[]) and x.officials_org = $3
          and g.officials_org = $3 and g.starts_at > $4`,
      [officialId, gameIds.map(String), officialsOrg, deps.now()],
    );
    return { ok: true as const, removed: r.rowCount ?? 0 };
  });
}

// An official's own coming games (their dashboard): every game they're on, in any group, soonest first, until it ends.
// Read only; who may see the dashboard is checked by its page.
export type MyOfficiatingGame = {
  id: string;
  kind: BoardGame["kind"];
  group: string; // the officials group that put them on it
  orgName: string; // the organization playing it
  home: string;
  away: string;
  start: Date;
  end: Date;
  place: string;
  address: string | null;
  position: number;
  partner: string | null; // the other referee, if one is set
  answer: Answer;
  started: boolean;
};
export async function myOfficiating(deps: Pick<Deps, "pool" | "now">, coachId: string): Promise<MyOfficiatingGame[]> {
  const r = await deps.pool.query<{
    key: string;
    kind: BoardGame["kind"];
    grp: string;
    org_name: string;
    home: string;
    away: string;
    starts_at: Date;
    minutes: number;
    place: string;
    address: string | null;
    position: number;
    partner: string | null;
    response: Answer;
  }>(
    `select g.key, g.kind, coalesce(go.short_name, go.name) as grp, o.name as org_name, g.home, g.away,
            g.starts_at, g.minutes, g.place, g.address, x.position, x.response,
            (select u.first_name || ' ' || u.last_name from game_officials y join users u on u.coach_id = y.coach_id
              where y.game_key = g.key and y.officials_org = g.officials_org and y.coach_id <> x.coach_id limit 1) as partner
       from ${LIVE}
       join organizations o on o.slug = g.org join organizations go on go.slug = x.officials_org
      where x.coach_id = $1 and g.starts_at + make_interval(mins => g.minutes) > $2
      order by g.starts_at, g.key`,
    [coachId, deps.now()],
  );
  return r.rows.map((g) => ({
    id: g.key,
    kind: g.kind,
    group: g.grp,
    orgName: g.org_name,
    home: g.home,
    away: g.away,
    start: g.starts_at,
    end: new Date(g.starts_at.getTime() + g.minutes * 60_000),
    place: g.place,
    address: g.address,
    position: g.position,
    partner: g.partner,
    answer: g.response,
    started: g.starts_at.getTime() <= deps.now().getTime(),
  }));
}

// The official answers a game they're on: ✓ "yes" (good for it) or ✗ "no" (can't make it). Only their own spot, only
// before the game starts. Tapping the same answer again clears it.
export async function answerGame(deps: Deps, viewer: SessionUser, input: { gameId: unknown; answer: unknown }): Promise<Result> {
  const gameId = String(input.gameId ?? "");
  if (!GAME.test(gameId)) return { ok: false, message: "That game wasn't found." };
  if (input.answer !== "yes" && input.answer !== "no" && input.answer !== null) return { ok: false, message: "Tap ✓ or ✗." };
  return withTx(deps.pool, async (q) => {
    const row = (
      await q.query<{ starts_at: Date }>(
        `select g.starts_at from ${LIVE} where x.game_key = $1 and x.coach_id = $2 for update of x`,
        [gameId, viewer.coachId],
      )
    ).rows[0];
    if (!row) return { ok: false as const, message: "You're not on that game any more." };
    if (row.starts_at.getTime() <= deps.now().getTime()) return { ok: false as const, message: "That game has started." };
    await q.query("update game_officials set response = $3, responded_at = $4 where game_key = $1 and coach_id = $2", [
      gameId,
      viewer.coachId,
      input.answer,
      input.answer === null ? null : deps.now(),
    ]);
    return { ok: true as const };
  });
}

// For the Games to officiate card's title (without building the board): how many coming games the group has, and how
// many referee spots are still open on those that haven't started. Null for anyone but its Admins and Assigners.
export async function officiatingSummary(deps: Deps, viewer: SessionUser, officialsOrg: string): Promise<{ games: number; open: number } | null> {
  if (!(await managesOfficials(deps.pool, viewer, officialsOrg))) return null;
  const r = await deps.pool.query<{ games: number; open: number }>(
    `select count(*)::int as games,
            coalesce(sum(case when g.starts_at > $2 then ${SPOTS.length} - (select count(*) from game_officials x
                                                                          where x.game_key = g.key and x.officials_org = g.officials_org)
                          else 0 end), 0)::int as open
       from officiated_games g
      where g.officials_org = $1 and g.starts_at + make_interval(mins => g.minutes) > $2`,
    [officialsOrg, deps.now()],
  );
  return r.rows[0];
}
