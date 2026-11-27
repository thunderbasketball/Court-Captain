// Scenic City Scheduler: matchups (SPEC.md section 13, step 7). For one division on one Game Day, Admins and Directors
// of Scheduling tap Create matchups: the division's teams playing that day are paired, each getting its games
// guaranteed (1GG = one game, 2GG = two), never the same pair twice that day. Pairs that already met on the League's
// other Game Days are avoided first, then teams from the same club, then teams from different grade groups.
// Creating again replaces that division's matchups for the day. Create all matchups does every division that day.
// A coach with more than one team: their teams are all home or all away that day, and play the same organization
// where it can be (so an away coach goes to one gym).
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { getProgram, isScheduler, teamsByDate, type DateTeam, type ProgramDetail } from "./scenic-programs";
import { withTx, type Queryable } from "./sql";
import { coachGroups } from "./coach-groups";
import { dayGrid, fillClash, gymBlocks } from "./scenic-grid";
import { hostRoom, hostShares, planOrder } from "./host-room";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

// hadTbd: it already played TBD on another Game Day this season, so it shouldn't be the one left without an opponent.
// coach: set when its coach has another team playing that day.
export type MatchTeam = {
  id: string;
  need: number;
  club: string;
  grade: number;
  level: string;
  hadTbd?: boolean;
  coach?: string;
  host?: number; // its organization: 2 has a gym open that day, 1 hosts games, 0 doesn't
};
export type Plan = { pairs: [string, string][]; short: { id: string; games: number }[] };

const key = (a: string, b: string) => (BigInt(a) < BigInt(b) ? `${a}-${b}` : `${b}-${a}`);
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// A small seeded random, so the same teams give the same plan.
function random(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

// Pairs teams for one day. `met`: how many times each pair (key a-b) already played on other days. `coachOpp`: for a
// coach with several teams, the organizations their teams already play that day (in other divisions).
// Tries many orders and keeps the plan with the fewest games missing, then the fewest left short who already played TBD
// this season, then the lowest cost.
export function planMatchups(
  teams: MatchTeam[],
  met: Map<string, number>,
  tries = 300,
  coachOpp: Map<string, Set<string>> = new Map(),
  evaluate: (pairs: [string, string][]) => number = () => 0, // a whole plan's extra cost (how uneven the hosts' home games are)
): Plan {
  // In order of importance, each outweighing everything after it over a whole day's plan: a pair that already met on
  // another Game Day, then two teams from the same organization (club), then two teams neither of which can host (no home
  // gym for the game), then grade differences and how evenly the hosts share the home games, then a coach's team
  // playing a different organization than their other teams. REC never plays COMP (not offered at all).
  let opp = coachOpp;
  const canHost = Math.max(0, ...teams.map((t) => t.host ?? 0));
  const apart = (x: MatchTeam, other: MatchTeam) =>
    x.coach && opp.get(x.coach)?.size && !opp.get(x.coach)!.has(other.club) ? 15 : 0;
  const cost = (a: MatchTeam, b: MatchTeam) =>
    (met.get(key(a.id, b.id)) ?? 0) * 1_000_000 +
    (a.club === b.club ? 10_000 : 0) +
    (Math.max(a.host ?? 0, b.host ?? 0) < canHost ? 500 : 0) +
    Math.abs(a.grade - b.grade) * 20 +
    apart(a, b) +
    apart(b, a);
  const rand = random(teams.length * 7919 + 17);
  let best: { pairs: [string, string][]; missing: number; tbd: number; cost: number; need: Map<string, number> } | null = null;
  for (let t = 0; t < tries; t++) {
    const order = teams
      .map((x) => ({ x, r: rand() }))
      .sort((p, q) => p.r - q.r)
      .map((p) => p.x);
    const need = new Map(order.map((x) => [x.id, x.need]));
    opp = new Map([...coachOpp].map(([k, v]) => [k, new Set(v)]));
    const today = new Set<string>();
    const pairs: [string, string][] = [];
    let total = 0;
    for (;;) {
      const open = order.filter((x) => need.get(x.id)! > 0);
      // Never REC against COMP: a team only plays teams of its own level.
      const options = (a: MatchTeam) => open.filter((b) => b.id !== a.id && b.level === a.level && !today.has(key(a.id, b.id)));
      // The team with the most games left goes first; then the one with the fewest possible opponents.
      const a = open
        .filter((x) => options(x).length)
        .sort((p, q) => need.get(q.id)! - need.get(p.id)! || options(p).length - options(q).length)[0];
      if (!a) break;
      const b = options(a).sort((p, q) => cost(a, p) - cost(a, q))[0];
      today.add(key(a.id, b.id));
      need.set(a.id, need.get(a.id)! - 1);
      need.set(b.id, need.get(b.id)! - 1);
      pairs.push([a.id, b.id]);
      total += cost(a, b);
      for (const [x, y] of [
        [a, b],
        [b, a],
      ])
        if (x.coach) opp.set(x.coach, (opp.get(x.coach) ?? new Set()).add(y.club));
    }
    total += evaluate(pairs);
    const missing = [...need.values()].reduce((n, v) => n + v, 0);
    const tbd = teams.filter((x) => x.hadTbd && need.get(x.id)! > 0).length;
    if (
      !best ||
      missing < best.missing ||
      (missing === best.missing && (tbd < best.tbd || (tbd === best.tbd && total < best.cost)))
    )
      best = { pairs, missing, tbd, cost: total, need };
    if (best.missing <= 1 && best.tbd === 0 && best.cost === 0) break;
  }
  return {
    pairs: best?.pairs ?? [],
    short: best ? teams.filter((x) => best.need.get(x.id)! > 0).map((x) => ({ id: x.id, games: best.need.get(x.id)! })) : [],
  };
}

// Home and away. First, a team whose organization hosts (has a gym open that day, else hosts games at all) is home against one
// whose doesn't, or against TBD; a host with no room left (`room`) counts as having no gym. Then a coach with several teams keeps
// them together: all home or all away (`coachSide`: what their teams already are that day). Then each host gets its share of the home
// games (`share`: as even as possible over the whole day, within its open slots; without one, even with `today`).
// Then each team alternates: home on its last Game Day means away now, and away means home. Where none of that decides it, each
// organization (club) gets about half its games at home that day, then the team with fewer home games this season is home.
// A game: two teams, or one team against TBD (b null; side "a" = the team is home). `fixed`: a side already set
// (a matchup kept from before), counted but not changed. Returns each game's home side.
export type HomeTeam = { club: string; last: "H" | "A" | null; homeGames: number; coach?: string; host?: number };
export function assignHome(
  games: { a: string; b: string | null; fixed?: "a" | "b" }[],
  teams: Map<string, HomeTeam>,
  today: Map<string, { home: number; total: number }> = new Map(),
  coachSide: Map<string, "H" | "A"> = new Map(),
  room: Map<string, number> | null = null, // each hosting organization's home games it has room for (null: not limited)
  share: Map<string, number> | null = null, // and its share of them here
): ("a" | "b")[] {
  const clubOf = (id: string | null) => (id ? (teams.get(id)?.club ?? null) : null);
  const hosting = (id: string | null) => {
    const h = id ? (teams.get(id)?.host ?? 0) : 0;
    return h === 2 && room && (room.get(clubOf(id)!) ?? 0) <= 0 ? 1 : h;
  };
  const sidesOf = (g: { a: string; b: string | null }, side: "a" | "b") => (side === "a" ? [g.a, g.b] : [g.b, g.a]) as [string | null, string | null];
  // Home is the one who hosts less.
  const wrongHost = (g: { a: string; b: string | null }, side: "a" | "b") => {
    const [h, v] = sidesOf(g, side);
    return hosting(v) > hosting(h) ? 1 : 0;
  };
  const homes = new Map<string, number>(); // each organization's home games in this list
  const addHome = (id: string | null, n = 1) => {
    const c = clubOf(id);
    if (c) homes.set(c, (homes.get(c) ?? 0) + n);
  };
  const dayHomes = (c: string) => (share ? -(share.get(c) ?? 0) : (today.get(c)?.home ?? 0)) + (homes.get(c) ?? 0);
  const full = (c: string) => !!room && (homes.get(c) ?? 0) >= (room.get(c) ?? 0);
  // Two hosts: how much the home one should rather be away: it's full and the other isn't, then how many home games it's ahead of its share (or today).
  const ahead = (g: { a: string; b: string | null }, side: "a" | "b") => {
    const [h, v] = sidesOf(g, side);
    const [ch, cv] = [clubOf(h), clubOf(v)];
    if (!hosting(h) || !hosting(v) || ch === cv) return 0;
    return (full(ch!) ? 1000 : 0) - (full(cv!) ? 1000 : 0) + dayHomes(ch!) - dayHomes(cv!);
  };
  const org = new Map([...today].map(([k, v]) => [k, { ...v }]));
  const coachAt = new Map(coachSide);
  // A team with two games that day is home in both or away in both (before anything else).
  const teamAt = new Map<string, "H" | "A">();
  const setCoach = (g: { a: string; b: string | null }, side: "a" | "b") => {
    if (g.a) teamAt.set(g.a, side === "a" ? "H" : "A");
    if (g.b) teamAt.set(g.b, side === "b" ? "H" : "A");
    for (const [id, s] of [
      [g.a, "a"],
      [g.b, "b"],
    ] as const) {
      const c = id && teams.get(id)?.coach;
      if (c && !coachAt.has(c)) coachAt.set(c, s === side ? "H" : "A");
    }
  };
  for (const g of games)
    if (g.fixed) {
      setCoach(g, g.fixed);
      addHome(g.fixed === "a" ? g.a : g.b);
    }
  // Splitting a team: this side's home team is away in its other game, or its away team is home there.
  const teamSplits = (g: { a: string; b: string | null }, side: "a" | "b") => {
    const [h, v] = side === "a" ? [g.a, g.b] : [g.b, g.a];
    return (h && teamAt.get(h) === "A" ? 1 : 0) + (v && teamAt.get(v) === "H" ? 1 : 0);
  };
  // Splitting a coach: this side's home team's coach is away elsewhere that day, or its away team's coach is home.
  const splits = (g: { a: string; b: string | null }, side: "a" | "b") => {
    const [h, v] = side === "a" ? [g.a, g.b] : [g.b, g.a];
    const ch = h && teams.get(h)?.coach;
    const cv = v && teams.get(v)?.coach;
    return (ch && coachAt.get(ch) === "A" ? 1 : 0) + (cv && coachAt.get(cv) === "H" ? 1 : 0);
  };
  const count = (id: string | null, home: boolean, total: boolean) => {
    const c = id && teams.get(id)?.club;
    if (!c) return;
    const o = org.get(c) ?? { home: 0, total: 0 };
    if (home) o.home++;
    if (total) o.total++;
    org.set(c, o);
  };
  for (const g of games) {
    count(g.a, g.fixed === "a", true);
    count(g.b, g.fixed === "b", true);
  }
  // Breaking the alternation for a side: its home team was home last time, its away team was away last time.
  const breaks = (g: { a: string; b: string | null }, side: "a" | "b") => {
    const [h, v] = side === "a" ? [g.a, g.b] : [g.b, g.a];
    return (h && teams.get(h)?.last === "H" ? 1 : 0) + (v && teams.get(v)?.last === "A" ? 1 : 0);
  };
  // How many home games this side's organization is still short of half its games that day (more: it should be home).
  // TBD has no organization (0), so a team against TBD is home when its organization is short of home games.
  const owed = (g: { a: string; b: string | null }, side: "a" | "b") => {
    const h = side === "a" ? g.a : g.b;
    const c = h && teams.get(h)?.club;
    const o = c ? org.get(c) : undefined;
    return o ? o.total / 2 - o.home : 0;
  };
  const out: ("a" | "b")[] = games.map((g) => g.fixed ?? "a");
  // Games hosting decides go first, then those the alternation does, so the organizations' balance is evened out with the rest.
  const order = games
    .map((g, i) => ({ g, i, gap: Math.abs(wrongHost(g, "a") - wrongHost(g, "b")) * 10 + Math.abs(breaks(g, "a") - breaks(g, "b")) }))
    .filter((x) => !x.g.fixed)
    .sort((x, y) => y.gap - x.gap || x.i - y.i);
  for (const { g, i } of order) {
    const score = (side: "a" | "b") => {
      const h = side === "a" ? g.a : g.b;
      return [teamSplits(g, side), wrongHost(g, side), splits(g, side), Math.max(0, ahead(g, side)), breaks(g, side), -owed(g, side), h ? (teams.get(h)?.homeGames ?? 0) : 0];
    };
    const [x, y] = [score("a"), score("b")];
    const at = x.findIndex((v, k) => v !== y[k]);
    const side = at < 0 || x[at] < y[at] ? "a" : "b";
    out[i] = side;
    count(side === "a" ? g.a : g.b, true, false);
    addHome(side === "a" ? g.a : g.b);
    setCoach(g, side);
  }
  if (![...teams.values()].some((x) => x.host)) return out;
  // Then one game at a time is turned around while that makes the whole list better.
  const free = games.map((g, i) => i).filter((i) => !games[i].fixed && games[i].b !== null);
  let best = homeCost(games, out, teams, today, coachSide, room, share).all;
  for (let pass = 0; pass < 4; pass++) {
    let better = false;
    for (const i of free) {
      out[i] = out[i] === "a" ? "b" : "a";
      const c = homeCost(games, out, teams, today, coachSide, room, share).all;
      if (c < best - 1e-9) {
        best = c;
        better = true;
      } else out[i] = out[i] === "a" ? "b" : "a";
    }
    if (!better) break;
  }
  return out;
}

// How good a list of home sides is (less is better): a team that can't host at home to one that can, home games over a host's room,
// coaches split, how far the hosts are from their shares (or from even, over the day and in the list), broken alternation, then teams home more this season.
// `plan`: the part that depends on who plays whom, for choosing the pairs.
export function homeCost(
  games: { a: string; b: string | null }[],
  sides: ("a" | "b")[],
  teams: Map<string, HomeTeam>,
  today: Map<string, { home: number; total: number }>,
  coachSide: Map<string, "H" | "A">,
  room: Map<string, number> | null,
  share: Map<string, number> | null = null,
): { all: number; plan: number } {
  const rank = (id: string | null) => {
    const t = id ? teams.get(id) : undefined;
    return !t?.host ? 0 : t.host === 2 && room && (room.get(t.club) ?? 0) <= 0 ? 1 : t.host;
  };
  const homes = new Map<string, number>();
  const at = new Map<string, { H: number; A: number }>([...coachSide].map(([c, s]) => [c, { H: s === "H" ? 1 : 0, A: s === "A" ? 1 : 0 }]));
  let wrong = 0;
  let breaks = 0;
  let season = 0;
  games.forEach((g, i) => {
    const [h, v] = sides[i] === "a" ? [g.a, g.b] : [g.b, g.a];
    if (rank(v) > rank(h)) wrong++;
    const [th, tv] = [h ? teams.get(h) : undefined, v ? teams.get(v) : undefined];
    if (th?.host) homes.set(th.club, (homes.get(th.club) ?? 0) + 1);
    if (th?.last === "H") breaks++;
    if (tv?.last === "A") breaks++;
    season += th?.homeGames ?? 0;
    for (const [t, s] of [[th, "H"], [tv, "A"]] as const)
      if (t?.coach) {
        const x = at.get(t.coach) ?? { H: 0, A: 0 };
        x[s]++;
        at.set(t.coach, x);
      }
  });
  const split = [...at.values()].reduce((n, x) => n + Math.min(x.H, x.A), 0);
  // A team home in one game and away in its other that day.
  const teamSides = new Map<string, { H: number; A: number }>();
  games.forEach((g, i) => {
    const [h, v] = sides[i] === "a" ? [g.a, g.b] : [g.b, g.a];
    for (const [t, k] of [[h, "H"], [v, "A"]] as const)
      if (t) {
        const x = teamSides.get(t) ?? { H: 0, A: 0 };
        x[k]++;
        teamSides.set(t, x);
      }
  });
  const teamSplit = [...teamSides.values()].reduce((n, x) => n + Math.min(x.H, x.A), 0);
  let over = 0;
  let even = 0;
  let list = 0;
  let off = 0;
  const hosts = new Set([...teams.values()].filter((t) => t.host).map((t) => t.club));
  for (const c of hosts) {
    const n = homes.get(c) ?? 0;
    if (room && teams.size) over += Math.max(0, n - (room.get(c) ?? n));
    if (share) off += (n - (share.get(c) ?? 0)) ** 2;
    else {
      even += ((today.get(c)?.home ?? 0) + n) ** 2;
      list += n ** 2;
    }
  }
  const balance = share ? off * 170 : even * 50 + list * 20;
  return { all: teamSplit * 1e7 + wrong * 1e6 + split * 1e5 + over * 2e4 + balance + breaks * 15 + season * 0.1, plan: over * 400 + balance / 12 + breaks * 6 };
}

// Games keep their grid slot when a division's matchups are saved or created again: the same pair (or the same team
// against TBD) stays where it was. Also returns each kept pair's home side, for a save to keep it.
async function keepSlots(q: PoolClient, programId: string, day: string, divisionId: string) {
  const r = await q.query<{
    a: string;
    b: string | null;
    side: "a" | "b" | null;
    court: string | null;
    starts: string | null;
    by: string | null;
    at: Date | null;
  }>(
    `select team_a::text as a, team_b::text as b, home_side as side, court_key as court, starts::text, placed_by as by, placed_at as at
       from scenic_matchups where program_id = $1 and day = $2::date and division_id = $3`,
    [programId, day, divisionId],
  );
  const sides = new Map(r.rows.map((x) => [`${x.a}-${x.b ?? "TBD"}`, x.side ?? "a"]));
  return {
    sides,
    restore: async () => {
      for (const x of r.rows.filter((x) => x.court))
        await q.query(
          `update scenic_matchups set court_key = $5, starts = $6::time, placed_by = $7, placed_at = $8
            where program_id = $1 and day = $2::date and team_a = $3 and team_b is not distinct from $4::bigint`,
          [programId, day, x.a, x.b, x.court, x.starts, x.by, x.at],
        );
    },
  };
}

// What home and away need to know: each of the division's teams' organization, whether it was home or away on its last
// Game Day before this one, its home games this season and its TBD games (dates); pairs already played on other Game
// Days; and each organization's games already set in the League's other divisions that day.
async function history(
  q: PoolClient,
  programId: string,
  day: string,
  divisionId: string,
  teams: DateTeam[],
  skip: string[] = [],
  locked: ReadonlySet<string> = new Set(), // teams whose games that day are published: they stay, so they count
  host: ReadonlyMap<string, number> = new Map(),
) {
  const club = new Map(teams.map((t) => [t.teamId, t.from]));
  const coach = coachesOf(teams);
  const rows = (
    await q.query<{ a: string; b: string | null; side: "a" | "b" | null; day: string; division: string }>(
      `select team_a::text as a, team_b::text as b, home_side as side, day::text, division_id::text as division
         from scenic_matchups where program_id = $1 order by day, id`,
      [programId],
    )
  ).rows;
  const met = new Map<string, number>();
  const metOn = new Map<string, string[]>();
  const tbdOn = new Map<string, string>();
  const home = new Map<string, HomeTeam>(
    teams.map((t) => [t.teamId, { club: t.from, last: null, homeGames: 0, coach: coach.get(t.teamId), host: host.get(t.teamId) ?? 0 }]),
  );
  const today = new Map<string, { home: number; total: number }>();
  const coachSide = new Map<string, "H" | "A">();
  const coachOpp = new Map<string, Set<string>>();
  for (const r of rows) {
    const side = r.side ?? "a";
    if (r.day === day) {
      if ((r.division === divisionId || skip.includes(r.division)) && !locked.has(r.a)) continue;
      // A coach's teams already set in other divisions that day: home or away, and against which organizations.
      for (const [id, s, other] of [
        [r.a, "a", r.b],
        [r.b, "b", r.a],
      ] as const) {
        const c = id && coach.get(id);
        if (!c) continue;
        if (!coachSide.has(c)) coachSide.set(c, side === s ? "H" : "A");
        const o = other && club.get(other);
        if (o) coachOpp.set(c, (coachOpp.get(c) ?? new Set()).add(o));
      }
      for (const [id, s] of [
        [r.a, "a"],
        [r.b, "b"],
      ] as const) {
        const c = id && club.get(id);
        if (!c) continue;
        const o = today.get(c) ?? { home: 0, total: 0 };
        o.total++;
        if (side === s) o.home++;
        today.set(c, o);
      }
      continue;
    }
    if (r.b) {
      met.set(key(r.a, r.b), (met.get(key(r.a, r.b)) ?? 0) + 1);
      metOn.set(key(r.a, r.b), [...(metOn.get(key(r.a, r.b)) ?? []), r.day]);
    } else if (!tbdOn.has(r.a)) tbdOn.set(r.a, r.day);
    for (const [id, s] of [
      [r.a, "a"],
      [r.b, "b"],
    ] as const) {
      const t = id && home.get(id);
      if (!t) continue;
      if (side === s) t.homeGames++;
      if (r.day < day) t.last = side === s ? "H" : "A"; // rows are in date order: the latest earlier Game Day wins
    }
  }
  return { met, metOn, tbdOn, home, today, coach, coachSide, coachOpp };
}

// The levels published that day: their matchups stay as they are until they're unpublished.
async function publishedOn(q: Pick<Queryable, "query">, programId: string, day: string): Promise<Set<string>> {
  const r = await q.query<{ level: string }>("select level from scenic_published_schedules where program_id = $1 and day = $2::date", [programId, day]);
  return new Set(r.rows.map((x) => x.level));
}
const publishedMessage = (levels: Iterable<string>) => {
  const l = [...levels].sort().reverse().join(" and ");
  return `That day's ${l} schedule is published: its games can't be changed. Unpublish ${l} for that day first.`;
};

// Teams playing that day (not taken out) that share a coach, Head or Assistant: team id → its group (lib/coach-groups).
export function coachesOf(teams: DateTeam[]): Map<string, string> {
  const groups = coachGroups(teams.filter((t) => !t.removedBy && !t.out));
  return new Map(groups.flatMap((g) => g.map((t) => [t.teamId, `g:${g[0].teamId}`] as const)));
}

// A team filling in for a TBD: an extra game for it.
type Fill = { team: string; by: string | null; at: Date | null };

// Saves a division's games for the day: each [a, b] (b null: TBD) with its home side, team_a the lower id.
async function insertGames(
  q: PoolClient,
  programId: string,
  divisionId: string,
  day: string,
  games: { a: string; b: string | null; side: "a" | "b"; fill?: Fill }[],
  by: string,
  now: Date,
) {
  for (const g of games) {
    const swap = !g.fill && g.b !== null && BigInt(g.b) < BigInt(g.a); // a fill-in game: the team it's for first
    const [lo, hi] = swap ? [g.b, g.a] : [g.a, g.b];
    const side = swap ? (g.side === "a" ? "b" : "a") : g.side;
    await q.query(
      `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, home_side, created_by, created_at, fill_team, filled_by, filled_at)
       values ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [programId, divisionId, day, lo, hi, side, by, now, g.fill?.team ?? null, g.fill?.by ?? null, g.fill?.at ?? null],
    );
  }
}

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// The division's teams still playing that day (not taken out or withdrawn), with their games guaranteed.
export function playingTeams(teams: DateTeam[], divisionId: string): DateTeam[] {
  return teams.filter((t) => t.divisionId === divisionId && !t.removedBy && !t.out);
}

// Create (or create again) one division's matchups on one Game Day, all of them or only REC's or COMP's (the other level's
// games stay as they are). Admins and Directors of Scheduling only.
// A team left without an opponent plays TBD, unless it already played TBD this season (then it's listed as short).
// Home and away: see assignHome.
export async function createMatchups(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  day: unknown,
  divisionId: unknown,
  skip: string[] = [], // divisions about to be created again (Create all): their games that day don't count
  only: unknown = null, // "REC" or "COMP"
): Promise<Result<{ created: number; short: string[]; repeats: string[]; tbd: string[] }>> {
  if (!isId(programId) || !isDate(day) || !isId(divisionId)) return { ok: false, message: "Pick a division on a Game Day." };
  if (only !== null && only !== "REC" && only !== "COMP") return { ok: false, message: "Pick REC or COMP." };
  if (!(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
  const p = await getProgram(deps, viewer, programId);
  if (!p || p.kind !== "League") return { ok: false, message: "That League wasn't found." };
  const event = teamsByDate(p).find((e) => !e.bracket && e.date === day);
  if (!event) return { ok: false, message: "That isn't one of this League's Game Days." };
  const division = p.divisionList.find((d) => d.id === divisionId);
  if (!division) return { ok: false, message: "That division isn't in this League." };
  const everyone = playingTeams(event.teams, divisionId).filter((t) => !only || t.level === only);
  if (!everyone.length) return { ok: false, message: `${division.label} has no ${only ? `${only} ` : ""}teams playing that day.` };
  const host = await hostRanks(deps, viewer, day, event.teams);
  const { room, shares } = await hostPlan(deps, viewer, p, day, event.teams, divisionId, skip, only, host);
  const by = `${viewer.firstName} ${viewer.lastName}`;
  const name = new Map(everyone.map((t) => [t.teamId, t.name]));

  return withTx(deps.pool, async (q) => {
    // One Scheduler at a time per League, so two taps can't mix two plans.
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-matchups:' || $1))", [programId]);
    // A level published that day keeps its games: only the others are paired.
    const on = await publishedOn(q, programId, day);
    const teams = everyone.filter((t) => !on.has(t.level));
    if (!teams.length) return { ok: false as const, message: publishedMessage(new Set(everyone.map((t) => t.level))) };
    const h = await history(q, programId, day, divisionId, event.teams, skip, new Set(event.teams.filter((t) => on.has(t.level) || (only && t.level !== only)).map((t) => t.teamId)), host);
    const plan = planMatchups(
      teams.map((t) => ({
        id: t.teamId,
        need: t.entry!.perDate[day],
        club: t.from,
        grade: t.groupGrade,
        level: t.level,
        hadTbd: h.tbdOn.has(t.teamId),
        coach: h.coach.get(t.teamId),
        host: host.get(t.teamId) ?? 0,
      })),
      h.met,
      300,
      h.coachOpp,
      // Home games shared out evenly among the organizations that host, as many as they have room for.
      (pairs) => {
        const list = pairs.map(([a, b]) => ({ a, b }));
        return homeCost(list, assignHome(list, h.home, h.today, h.coachSide, room, shares), h.home, h.today, h.coachSide, room, shares).plan;
      },
    );
    // One TBD game for a team left short (never twice in a day), unless it already played TBD this season.
    const tbd = plan.short.filter((x) => !h.tbdOn.has(x.id)).map((x) => x.id);
    const games: { a: string; b: string | null }[] = [
      ...plan.pairs.map(([a, b]) => ({ a, b })),
      ...tbd.map((a) => ({ a, b: null })),
    ];
    const sides = assignHome(games, h.home, h.today, h.coachSide, room, shares);
    const kept = await keepSlots(q, programId, day, divisionId);
    await q.query(
      `delete from scenic_matchups m where m.program_id = $1 and m.day = $2::date and m.division_id = $3 and not scenic_game_published(m.program_id, m.day, m.team_a)
          and ($4::text is null or $4 = ${GAME_LEVEL})`,
      [programId, day, divisionId, only],
    );
    await insertGames(
      q,
      programId,
      divisionId,
      day,
      games.map((g, i) => ({ ...g, side: sides[i] })),
      by,
      deps.now(),
    );
    await kept.restore();
    const left = (s: { id: string; games: number }) => s.games - (tbd.includes(s.id) ? 1 : 0);
    return {
      ok: true as const,
      created: games.length,
      tbd: tbd.map((id) => `${name.get(id)} plays TBD`),
      short: plan.short
        .filter((s) => left(s) > 0)
        .map(
          (s) =>
            `${name.get(s.id)} needs ${left(s)} more game${left(s) === 1 ? "" : "s"}` +
            (h.tbdOn.has(s.id) ? ` (it already played TBD on ${shortDate(h.tbdOn.get(s.id)!)})` : ""),
        ),
      repeats: plan.pairs
        .filter(([a, b]) => h.met.has(key(a, b)))
        .map(([a, b]) => `${name.get(a)} vs ${name.get(b)} (also ${h.metOn.get(key(a, b))!.map(shortDate).join(", ")})`),
    };
  });
}

// Save one division's matchups on one Game Day as the Scheduler arranged them (drag and drop). Admins and Directors of
// Scheduling only. Every game is checked again here: both teams in this division and still playing that day (b null:
// TBD), not the same team twice, no pair twice that day, TBD at most once a team, and no team in more games than it's
// guaranteed. Replaces that division's matchups for the day; a pair kept from before keeps its home team and slot, new
// ones get home and away as assignHome sets them. Teams left out stay in the Sandbox (short).
export async function saveMatchups(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  day: unknown,
  divisionId: unknown,
  games: unknown,
): Promise<Result<{ saved: number }>> {
  if (!isId(programId) || !isDate(day) || !isId(divisionId)) return { ok: false, message: "Pick a division on a Game Day." };
  if (!Array.isArray(games) || games.length > 200) return { ok: false, message: "Those matchups weren't readable." };
  if (!(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
  const p = await getProgram(deps, viewer, programId);
  if (!p || p.kind !== "League") return { ok: false, message: "That League wasn't found." };
  const event = teamsByDate(p).find((e) => !e.bracket && e.date === day);
  if (!event) return { ok: false, message: "That isn't one of this League's Game Days." };
  if (!p.divisionList.some((d) => d.id === divisionId)) return { ok: false, message: "That division isn't in this League." };
  const teams = new Map(playingTeams(event.teams, divisionId).map((t) => [t.teamId, t]));
  const everyone = new Map(event.teams.filter((t) => !t.removedBy && !t.out).map((t) => [t.teamId, t])); // a fill-in: any division
  // Teams already filling in for a TBD that day: those games stay allowed (an extra game, any level).
  const fills = new Map(
    (
      await deps.pool.query<{ a: string; b: string; by: string | null; at: Date | null }>(
        `select team_a::text as a, team_b::text as b, filled_by as by, filled_at as at from scenic_matchups
          where program_id = $1 and day = $2::date and division_id = $3 and fill_team is not null`,
        [programId, day, divisionId],
      )
    ).rows.map((x) => [key(x.a, x.b), x] as const),
  );
  const seen = new Set<string>();
  const games0: { a: string; b: string | null; fill?: Fill }[] = [];
  const count = new Map<string, number>();
  for (const g of games as unknown[]) {
    const [a, b] = Array.isArray(g) ? g : [];
    if (!isId(a) || (b !== null && !isId(b))) return { ok: false, message: "Those matchups weren't readable." };
    const fill = b === null ? undefined : fills.get(key(a, b));
    const ta = fill?.b === a ? everyone.get(a) : teams.get(a);
    const tb = b === null ? null : fill?.b === b ? everyone.get(b) : teams.get(b);
    if (!ta || tb === undefined)
      return { ok: false, message: "A team in those matchups isn't playing in this division that day." };
    if (a === b) return { ok: false, message: `${ta.name} can't play itself.` };
    if (tb && tb.level !== ta.level && !fill)
      return {
        ok: false,
        message: `${ta.name} is ${ta.level} and ${tb.name} is ${tb.level}: REC and COMP teams never play each other.`,
      };
    const k = b === null ? `${a}-TBD` : key(a, b);
    if (seen.has(k))
      return { ok: false, message: b === null ? `${ta.name} plays TBD twice.` : `${ta.name} vs ${tb!.name} is in there twice.` };
    seen.add(k);
    games0.push(fill ? { a: fill.a, b: fill.b, fill: { team: fill.b, by: fill.by, at: fill.at } } : { a, b });
    for (const t of tb ? [ta, tb] : [ta]) {
      if (fill) continue; // made by hand: an extra game for the fill-in, and it never takes the other's place
      count.set(t.teamId, (count.get(t.teamId) ?? 0) + 1);
      const gg = t.entry!.perDate[day];
      if (count.get(t.teamId)! > gg)
        return { ok: false, message: `${t.name} is guaranteed ${gg} game${gg === 1 ? "" : "s"} that day; take it out of one.` };
    }
  }
  const host = await hostRanks(deps, viewer, day, event.teams);
  const by = `${viewer.firstName} ${viewer.lastName}`;
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-matchups:' || $1))", [programId]);
    const on = await publishedOn(q, programId, day);
    const locked = new Set(event.teams.filter((t) => on.has(t.level)).map((t) => t.teamId));
    if (locked.size) {
      // Published games stay as they are: sent back changed (or without one), it's refused; unchanged, they're left out of the save.
      const there = await q.query<{ a: string; b: string | null }>(
        `select team_a::text as a, team_b::text as b from scenic_matchups
          where program_id = $1 and day = $2::date and division_id = $3 and scenic_game_published(program_id, day, team_a)`,
        [programId, day, divisionId],
      );
      const saved = new Set(there.rows.map((g) => (g.b === null ? `${g.a}-TBD` : key(g.a, g.b))));
      const sent = new Set(games0.filter((g) => locked.has(g.a)).map((g) => (g.b === null ? `${g.a}-TBD` : key(g.a, g.b))));
      const playing = (id: string | null) => id === null || everyone.has(id);
      const added = [...sent].some((k) => !saved.has(k) && !there.rows.some((g) => [g.a, g.b].some((id) => k === `${id}-TBD`)));
      const gone = there.rows.some((g) => playing(g.a) && playing(g.b) && !sent.has(g.b === null ? `${g.a}-TBD` : key(g.a, g.b)));
      if (added || gone) return { ok: false as const, message: publishedMessage(on) };
    }
    const list = games0.filter((g) => !locked.has(g.a));
    const kept = await keepSlots(q, programId, day, divisionId);
    const h = await history(q, programId, day, divisionId, event.teams, [], locked, host);
    const { room, shares } = await hostPlan(deps, viewer, p, day, event.teams, divisionId, [], null, host);
    // A pair kept from before keeps its home side (stored with team_a the lower id).
    const fixed = list.map((g) => {
      const swap = !g.fill && g.b !== null && BigInt(g.b) < BigInt(g.a);
      const side = kept.sides.get(swap ? `${g.b}-${g.a}` : `${g.a}-${g.b ?? "TBD"}`);
      return side ? (swap ? (side === "a" ? "b" : "a") : side) : undefined;
    });
    const sides = assignHome(
      list.map((g, i) => ({ ...g, fixed: fixed[i] })),
      h.home,
      h.today,
      h.coachSide,
      room,
      shares,
    );
    await q.query("delete from scenic_matchups where program_id = $1 and day = $2::date and division_id = $3 and not scenic_game_published(program_id, day, team_a)", [
      programId,
      day,
      divisionId,
    ]);
    await insertGames(
      q,
      programId,
      divisionId,
      day,
      list.map((g, i) => ({ ...g, side: sides[i] })),
      by,
      deps.now(),
    );
    await kept.restore();
    return { ok: true as const, saved: games0.length };
  });
}

// A game's level (m): the level its team_a is registered in.
const GAME_LEVEL = `coalesce((select g.level from scenic_registrations r join scenic_pools o on o.id = r.pool_id join scenic_grade_groups g on g.id = o.group_id
                                where r.program_id = m.program_id and r.team_id = m.team_a),
                              (select t.level from scenic_teams t where t.id = m.team_a))`;

// A game made by hand (a TBD dragged into the New game box): a team of this division against any team playing that day, of any
// level, grade or division, or TBD (null). Two teams of one division and level that both still need a game: a regular one; else
// the second team is filling in, an extra game for it. Home: whoever hosts. Not in a published level.
export async function addGame(deps: Deps, viewer: SessionUser, programId: unknown, day: unknown, divisionId: unknown, a: unknown, b: unknown): Promise<Result> {
  if (!isId(programId) || !isDate(day) || !isId(divisionId)) return { ok: false, message: "Pick a division on a Game Day." };
  if (!isId(a) || (b !== null && !isId(b)) || a === b) return { ok: false, message: "Pick two different teams." };
  if (!(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
  const p = await getProgram(deps, viewer, programId);
  const event = p?.kind === "League" ? teamsByDate(p).find((e) => !e.bracket && e.date === day) : undefined;
  if (!event) return { ok: false, message: "That isn't one of this League's Game Days." };
  const ta = playingTeams(event.teams, divisionId).find((t) => t.teamId === a);
  const tb = b === null ? null : event.teams.find((t) => t.teamId === b && !t.removedBy && !t.out);
  if (!ta || tb === undefined) return { ok: false, message: "Pick teams playing that day, the first from this division." };
  const host = await hostRanks(deps, viewer, day, event.teams);
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-matchups:' || $1))", [programId]);
    if ((await publishedOn(q, programId, day)).has(ta.level)) return { ok: false as const, message: publishedMessage([ta.level]) };
    const there = (
      await q.query<{ a: string; b: string | null; fill: string | null }>(
        "select team_a::text as a, team_b::text as b, fill_team::text as fill from scenic_matchups where program_id = $1 and day = $2::date and (team_a = any($3::bigint[]) or team_b = any($3::bigint[]))",
        [programId, day, b === null ? [a] : [a, b]],
      )
    ).rows;
    if (b === null && there.some((g) => g.a === a && g.b === null)) return { ok: false as const, message: `${ta.name} already plays TBD that day.` };
    if (tb && there.some((g) => [g.a, g.b].includes(a) && [g.a, g.b].includes(tb.teamId))) return { ok: false as const, message: `${ta.name} and ${tb.name} already play each other that day.` };
    const needs = (t: DateTeam) => there.filter((g) => [g.a, g.b].includes(t.teamId) && g.fill !== t.teamId).length < (t.entry?.perDate[day] ?? 0);
    const regular = !tb || (tb.divisionId === ta.divisionId && tb.level === ta.level && needs(ta) && needs(tb));
    const [x, y] = [host.get(a) ?? 0, (tb && host.get(tb.teamId)) ?? 0];
    const by = `${viewer.firstName} ${viewer.lastName}`;
    const now = deps.now();
    await insertGames(q, programId, divisionId, day, [{ a, b, side: y > x ? "b" : "a", fill: regular ? undefined : { team: tb!.teamId, by, at: now } }], by, now);
    return { ok: true as const };
  });
}

// How each team's organization hosts that day: 2 has a gym open then, 1 hosts games, 0 doesn't.
async function hostRanks(deps: Deps, viewer: SessionUser, day: string, teams: DateTeam[]): Promise<Map<string, number>> {
  const [grid, hosts] = await Promise.all([
    dayGrid(deps, viewer, day),
    deps.pool.query<{ id: string }>("select id::text from partners where approved and hosts_games"),
  ]);
  const open = new Set(grid?.gyms.map((g) => g.hostId));
  const any = new Set(hosts.rows.map((h) => h.id));
  return new Map(teams.map((t) => [t.teamId, t.partnerId === null ? 0 : open.has(t.partnerId) ? 2 : any.has(t.partnerId) ? 1 : 0]));
}

// What each organization can host in this division that day (by club): `room`, its open slots that take the division, less every
// other game of the day (any program's on its courts; this League's by its home organization); and `shares`, its share of the home
// games being made here. Shares look at all its teams: every group not made yet (a division's REC or COMP) is planned together, REC
// first, youngest to oldest, then COMP. The games being made again (this division's and `skip`'s, of the level asked) don't count.
async function hostPlan(
  deps: Deps,
  viewer: SessionUser,
  p: ProgramDetail,
  day: string,
  teams: DateTeam[],
  divisionId: string,
  skip: string[],
  only: unknown,
  host: Map<string, number>,
): Promise<{ room: Map<string, number> | null; shares: Map<string, number> | null }> {
  const grid = await dayGrid(deps, viewer, day);
  if (!grid?.gyms.length) return { room: null, shares: null };
  const courts = grid.gyms.flatMap((g) =>
    g.courts.map((c) => ({ id: c.id, hostId: g.hostId, divisions: c.divisions, slots: gymBlocks(grid, g.courts.reduce((m, x) => (x.starts < m ? x.starts : m), "23:59"), g.courts.reduce((m, x) => (x.ends > m ? x.ends : m), "00:00")).filter(([s, e]) => s >= c.starts && e <= c.ends).length })),
  );
  const rows = (
    await deps.pool.query<{ program: string; division: string; a: string; b: string | null; side: "a" | "b" | null; court: string | null; level: string; published: boolean }>(
      `select m.program_id::text as program, m.division_id::text as division, m.team_a::text as a, m.team_b::text as b, m.home_side as side, m.court_key as court,
              ${GAME_LEVEL} as level, scenic_game_published(m.program_id, m.day, m.team_a) as published
         from scenic_matchups m where m.day = $1::date order by m.id`,
      [day],
    )
  ).rows;
  const again = (g: (typeof rows)[number]) => g.program === p.id && (g.division === divisionId || skip.includes(g.division)) && (only === null || g.level === only) && !g.published;
  const stay = rows.filter((g) => !again(g));
  const partner = new Map(teams.map((t) => [t.teamId, t.partnerId]));
  const order = (d: { id: string; gradeLow: number }, level: string) => ({ level, grade: d.gradeLow, index: p.divisionList.findIndex((x) => x.id === d.id), id: d.id });
  const groups = planOrder(p.divisionList.flatMap((d) => ["REC", "COMP"].map((l) => order(d, l))));
  const used = stay.map((g) => {
    const home = (g.side ?? "a") === "a" ? g.a : g.b;
    return { hostId: g.program === p.id && home ? (partner.get(home) ?? null) : null, divisionId: g.division, court: g.court };
  });
  const base = new Map<string, number>();
  for (const u of used) if (u.hostId) base.set(u.hostId, (base.get(u.hostId) ?? 0) + 1);
  const here = (g: { id: string; level: string }) => g.id === divisionId && (only === null || g.level === only);
  const plan = groups
    .filter((g) => here(g) || !stay.some((x) => x.program === p.id && x.division === g.id && x.level === g.level))
    .map((g) => {
      const need = new Map<string, number>();
      let games = 0;
      for (const t of playingTeams(teams, g.id)) {
        if (t.level !== g.level) continue;
        const n = t.entry?.perDate[day] ?? 0;
        games += n;
        if (t.partnerId && host.get(t.teamId) === 2) need.set(t.partnerId, (need.get(t.partnerId) ?? 0) + n);
      }
      return { id: `${g.id} ${g.level}`, divisionId: g.id, games: Math.ceil(games / 2), need, here: here(g) };
    });
  const shares = hostShares(courts, used, base, plan);
  const mine = new Map<string, number>();
  for (const g of plan) if (g.here) for (const [h, n] of shares.get(g.id)!) mine.set(h, (mine.get(h) ?? 0) + n);
  const room = hostRoom(courts, used, divisionId);
  const byClub = (m: Map<string, number>) => new Map(teams.flatMap((t) => (t.partnerId && room.has(t.partnerId) ? [[t.from, m.get(t.partnerId) ?? 0] as const] : [])));
  return { room: byClub(room), shares: byClub(mine) };
}

// Clear one division's REC or COMP matchups on a Game Day (`only` null: both): every one not on the Grid (and not published or scored). Its teams go back to
// the Sandbox. Admins and Directors of Scheduling only.
export async function clearMatchups(deps: Deps, viewer: SessionUser, programId: unknown, day: unknown, divisionId: unknown, only: unknown = null): Promise<Result<{ cleared: number; kept: number }>> {
  if (!isId(programId) || !isDate(day) || !isId(divisionId)) return { ok: false, message: "Pick a division on a Game Day." };
  if (only !== null && only !== "REC" && only !== "COMP") return { ok: false, message: "Pick REC or COMP." };
  if (!(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-matchups:' || $1))", [programId]);
    const at = `m.program_id = $1 and m.day = $2::date and m.division_id = $3 and ($4::text is null or $4 = ${GAME_LEVEL})`;
    const r = await q.query(
      `delete from scenic_matchups m where ${at} and m.court_key is null and m.score_a is null and m.forfeit is null and not scenic_game_published(m.program_id, m.day, m.team_a)`,
      [programId, day, divisionId, only],
    );
    const kept = await q.query(`select 1 from scenic_matchups m where ${at}`, [programId, day, divisionId, only]);
    return { ok: true as const, cleared: r.rowCount ?? 0, kept: kept.rowCount ?? 0 };
  });
}

// A TBD filled in with any team playing that day, of any level, grade or division: an extra game for it. The game keeps its
// place on the Grid when that team and its coaches are free then. Home: whoever hosts. Not once published. `teamId` null:
// back to TBD. Admins and Directors of Scheduling only; who and when is recorded.
export async function fillTbd(deps: Deps, viewer: SessionUser, matchupId: unknown, teamId: unknown): Promise<Result> {
  if (!isId(matchupId) || (teamId !== null && !isId(teamId))) return { ok: false, message: "Pick a team." };
  if (!(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
  type Row = { program: string; day: string; division: string; a: string; b: string | null; fill: string | null; home: "a" | "b" | null; court: string | null; starts: string | null; published: boolean; scored: boolean };
  const read = (q: Pick<Queryable, "query">, lock = "") =>
    q.query<Row>(
      `select program_id::text as program, day::text, division_id::text as division, team_a::text as a, team_b::text as b, fill_team::text as fill, home_side as home,
              court_key as court, to_char(starts, 'HH24:MI') as starts, scenic_game_published(program_id, day, team_a) as published,
              (score_a is not null or forfeit is not null) as scored
         from scenic_matchups where id = $1 ${lock}`,
      [matchupId],
    );
  const first = (await read(deps.pool)).rows[0];
  if (!first) return { ok: false, message: "That game was changed. Reload the page." };
  const p = await getProgram(deps, viewer, first.program);
  const event = p && teamsByDate(p).find((e) => !e.bracket && e.date === first.day);
  if (!event) return { ok: false, message: "That isn't one of this League's Game Days." };
  const teams = new Map(event.teams.filter((t) => !t.removedBy && !t.out).map((t) => [t.teamId, t]));
  const host = await hostRanks(deps, viewer, first.day, event.teams);
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-matchups:' || $1))", [first.program]);
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-grid:' || $1))", [first.day]);
    const m = (await read(q, "for update")).rows[0];
    if (!m || m.a !== first.a) return { ok: false as const, message: "That game was changed. Reload the page." };
    if (m.published) return { ok: false as const, message: publishedMessage([teams.get(m.a)?.level ?? "day"]) };
    if (m.scored) return { ok: false as const, message: "That game has a score." };
    if (teamId === null) {
      if (!m.fill) return { ok: false as const, message: "That game has no team filling in." };
      const tbd = await q.query("select 1 from scenic_matchups where program_id = $1 and day = $2::date and team_a = $3 and team_b is null", [m.program, m.day, m.a]);
      if (tbd.rowCount) return { ok: false as const, message: `${teams.get(m.a)?.name ?? "That team"} already plays TBD that day.` };
      await q.query("update scenic_matchups set team_b = null, fill_team = null, filled_by = null, filled_at = null where id = $1", [matchupId]);
      return { ok: true as const };
    }
    if (m.b !== null) return { ok: false as const, message: "That game has an opponent now. Reload the page." };
    const [owner, t] = [teams.get(m.a), teams.get(teamId)];
    if (!owner || !t || teamId === m.a) return { ok: false as const, message: "Pick another team playing that day." };
    // A fill-in: the same gender (a Coed division plays either), a grade above or below at most, REC or COMP; never a team
    // it already plays this season.
    const gender = (x: { divisionName: string }) => x.divisionName.split(" ")[0];
    if (gender(owner) !== gender(t) && gender(owner) !== "Coed" && gender(t) !== "Coed")
      return { ok: false as const, message: `${t.name} is ${gender(t)}; ${owner.name} plays ${gender(owner)}.` };
    if (Math.abs(owner.groupGrade - t.groupGrade) > 1) return { ok: false as const, message: `Pick a team a grade above or below ${owner.name} at most.` };
    const already = await q.query<{ day: string }>(
      "select day::text from scenic_matchups where program_id = $1 and $2::bigint in (team_a, team_b) and $3::bigint in (team_a, team_b) order by day limit 1",
      [m.program, m.a, teamId],
    );
    if (already.rows[0])
      return { ok: false as const, message: `${owner.name} and ${t.name} already play each other${already.rows[0].day === m.day ? " that day" : " this season"}.` };
    if (m.court && m.starts) {
      const clash = await fillClash(deps, viewer, q, { id: matchupId, day: m.day, a: m.a, b: teamId, court: m.court, starts: m.starts });
      if (clash) return { ok: false as const, message: `${clash} Take this game off the Grid first, or pick another team.` };
    }
    const [x, y] = [host.get(m.a) ?? 0, host.get(teamId) ?? 0];
    await q.query("update scenic_matchups set team_b = $2, fill_team = $2, filled_by = $3, filled_at = $4, home_side = $5 where id = $1", [
      matchupId,
      teamId,
      `${viewer.firstName} ${viewer.lastName}`,
      deps.now(),
      x > y ? "a" : y > x ? "b" : (m.home ?? "a"),
    ]);
    return { ok: true as const };
  });
}

// Switch a game's home and away (a Director of Scheduling drags one team onto the other, or onto its TBD): not published or
// scored. Against TBD, home "b" means TBD is home (the team visits).
// Its place on the Grid stays (the grid then shows it at the visitors' gym, to move if wanted). Who and when are kept.
export async function switchHome(deps: Deps, viewer: SessionUser, matchupId: unknown): Promise<Result<{ placed: boolean }>> {
  if (!isId(matchupId)) return { ok: false, message: "Pick a game." };
  if (!(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
  return withTx(deps.pool, async (q) => {
    const m = (
      await q.query<{ home: "a" | "b" | null; placed: boolean; published: boolean; scored: boolean }>(
        `select home_side as home, court_key is not null as placed, scenic_game_published(program_id, day, team_a) as published,
                (score_a is not null or forfeit is not null) as scored
           from scenic_matchups where id = $1 for update`,
        [matchupId],
      )
    ).rows[0];
    if (!m) return { ok: false as const, message: "That game was changed. Reload the page." };
    if (m.published) return { ok: false as const, message: "That game is published, so it can't be changed. Unpublish its level for the day first." };
    if (m.scored) return { ok: false as const, message: "That game has a score." };
    await q.query("update scenic_matchups set home_side = $2, home_set_by = $3, home_set_at = $4 where id = $1", [
      matchupId,
      (m.home ?? "a") === "a" ? "b" : "a",
      `${viewer.firstName} ${viewer.lastName}`,
      deps.now(),
    ]);
    return { ok: true as const, placed: m.placed };
  });
}

// Create all matchups for one Game Day (or only REC's or COMP's): every League's divisions playing that day, in the League's order, each created again
// as Create matchups does (a coach's teams in an earlier division guide the later ones). Admins and Directors of
// Scheduling only.
export async function createDayMatchups(
  deps: Deps,
  viewer: SessionUser,
  day: unknown,
  programId?: unknown, // the program being scheduled (every League playing that day when left out)
  only: unknown = null, // "REC" or "COMP"
): Promise<Result<{ created: number; divisions: number; notes: string[] }>> {
  if (!isDate(day)) return { ok: false, message: "Pick a Game Day." };
  if (programId !== undefined && !isId(programId)) return { ok: false, message: "Pick a program." };
  if (only !== null && only !== "REC" && only !== "COMP") return { ok: false, message: "Pick REC or COMP." };
  if (!(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
  const ids = (
    await deps.pool.query<{ id: string }>(
      `select id::text from scenic_programs where kind = 'League' and ends_on >= $1::date and ($2::bigint is null or id = $2)
        order by starts_on, lower(name)`,
      [day, programId ?? null],
    )
  ).rows;
  let created = 0;
  let divisions = 0;
  const notes: string[] = [];
  for (const { id } of ids) {
    const p = await getProgram(deps, viewer, id);
    const event = p && teamsByDate(p).find((e) => !e.bracket && e.date === day);
    if (!p || !event) continue;
    const on = await publishedOn(deps.pool, id, day); // a level published that day keeps its games
    // Youngest to oldest (a day's REC is made before its COMP).
    const todo = planOrder(p.divisionList.map((d, index) => ({ ...d, level: "", grade: d.gradeLow, index }))).filter((d) => playingTeams(event.teams, d.id).some((t) => !on.has(t.level) && (!only || t.level === only)));
    const left = [...on].filter((l) => !only || l === only);
    if (left.length) notes.push(`${left.sort().reverse().join(" and ")}: published, left as ${left.length > 1 ? "they are" : "it is"}`);
    for (const [i, d] of todo.entries()) {
      const r = await createMatchups(
        deps,
        viewer,
        id,
        day,
        d.id,
        todo.slice(i + 1).map((x) => x.id),
        only,
      );
      if (!r.ok) {
        notes.push(`${d.label}: ${r.message}`);
        continue;
      }
      created += r.created;
      divisions++;
      notes.push(...[...r.tbd, ...r.short, ...r.repeats.map((x) => `Played before: ${x}`)].map((x) => `${d.label}: ${x}`));
    }
  }
  if (!divisions && !notes.length) return { ok: false, message: `No ${only ? `${only} ` : ""}teams are playing that day.` };
  return { ok: true, created, divisions, notes };
}
