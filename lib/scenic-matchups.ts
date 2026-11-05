// Scenic City Scheduler: matchups (SPEC.md section 13, step 7). For one division on one Game Day, Admins and Directors
// of Scheduling tap Create matchups: the division's teams playing that day are paired, each getting its games
// guaranteed (1GG = one game, 2GG = two), never the same pair twice that day. Pairs that already met on the League's
// other Game Days are avoided first, then teams from the same club, then teams from different grade groups.
// Creating again replaces that division's matchups for the day. Create all matchups does every division that day.
// A coach with more than one team: their teams are all home or all away that day, and play the same organization
// where it can be (so an away coach goes to one gym).
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { getProgram, isScheduler, teamsByDate, type DateTeam } from "./scenic-programs";
import { withTx } from "./sql";

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
): Plan {
  // In order of importance, each outweighing everything after it over a whole day's plan: a pair that already met on
  // another Game Day, then two teams from the same organization (club), then grade differences, then a coach's team
  // playing a different organization than their other teams. REC never plays COMP (not offered at all).
  let opp = coachOpp;
  const apart = (x: MatchTeam, other: MatchTeam) =>
    x.coach && opp.get(x.coach)?.size && !opp.get(x.coach)!.has(other.club) ? 15 : 0;
  const cost = (a: MatchTeam, b: MatchTeam) =>
    (met.get(key(a.id, b.id)) ?? 0) * 1_000_000 +
    (a.club === b.club ? 10_000 : 0) +
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

// Home and away. Each team alternates: home on its last Game Day means away now, and away means home. Where that
// doesn't decide it, each organization (club) gets about half its games at home that day (counting its games already
// set in other divisions, `today`), then the team with fewer home games this season is home. Before all that, a coach
// with several teams keeps them together: all home or all away (`coachSide`: what their teams already are that day).
// A game: two teams, or one team against TBD (b null; side "a" = the team is home). `fixed`: a side already set
// (a matchup kept from before), counted but not changed. Returns each game's home side.
export type HomeTeam = { club: string; last: "H" | "A" | null; homeGames: number; coach?: string };
export function assignHome(
  games: { a: string; b: string | null; fixed?: "a" | "b" }[],
  teams: Map<string, HomeTeam>,
  today: Map<string, { home: number; total: number }> = new Map(),
  coachSide: Map<string, "H" | "A"> = new Map(),
): ("a" | "b")[] {
  const org = new Map([...today].map(([k, v]) => [k, { ...v }]));
  const coachAt = new Map(coachSide);
  const setCoach = (g: { a: string; b: string | null }, side: "a" | "b") => {
    for (const [id, s] of [
      [g.a, "a"],
      [g.b, "b"],
    ] as const) {
      const c = id && teams.get(id)?.coach;
      if (c && !coachAt.has(c)) coachAt.set(c, s === side ? "H" : "A");
    }
  };
  for (const g of games) if (g.fixed) setCoach(g, g.fixed);
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
  // Games the alternation decides go first, so the organizations' balance is evened out with the rest.
  const order = games
    .map((g, i) => ({ g, i, gap: Math.abs(breaks(g, "a") - breaks(g, "b")) }))
    .filter((x) => !x.g.fixed)
    .sort((x, y) => y.gap - x.gap || x.i - y.i);
  for (const { g, i } of order) {
    const score = (side: "a" | "b") => {
      const h = side === "a" ? g.a : g.b;
      return [splits(g, side), breaks(g, side), -owed(g, side), h ? (teams.get(h)?.homeGames ?? 0) : 0];
    };
    const [x, y] = [score("a"), score("b")];
    const at = x.findIndex((v, k) => v !== y[k]);
    const side = at < 0 || x[at] < y[at] ? "a" : "b";
    out[i] = side;
    count(side === "a" ? g.a : g.b, true, false);
    setCoach(g, side);
  }
  return out;
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
    teams.map((t) => [t.teamId, { club: t.from, last: null, homeGames: 0, coach: coach.get(t.teamId) }]),
  );
  const today = new Map<string, { home: number; total: number }>();
  const coachSide = new Map<string, "H" | "A">();
  const coachOpp = new Map<string, Set<string>>();
  for (const r of rows) {
    const side = r.side ?? "a";
    if (r.day === day) {
      if (r.division === divisionId || skip.includes(r.division)) continue;
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

// The coaches with more than one team playing that day (not taken out): team id → its coach.
export function coachesOf(teams: DateTeam[]): Map<string, string> {
  const by = new Map<string, string[]>();
  for (const t of teams) if (t.coachKey && !t.removedBy && !t.out) by.set(t.coachKey, [...(by.get(t.coachKey) ?? []), t.teamId]);
  return new Map([...by].filter(([, ids]) => ids.length > 1).flatMap(([c, ids]) => ids.map((id) => [id, c] as const)));
}

// Saves a division's games for the day: each [a, b] (b null: TBD) with its home side, team_a the lower id.
async function insertGames(
  q: PoolClient,
  programId: string,
  divisionId: string,
  day: string,
  games: { a: string; b: string | null; side: "a" | "b" }[],
  by: string,
  now: Date,
) {
  for (const g of games) {
    const swap = g.b !== null && BigInt(g.b) < BigInt(g.a);
    const [lo, hi] = swap ? [g.b, g.a] : [g.a, g.b];
    const side = swap ? (g.side === "a" ? "b" : "a") : g.side;
    await q.query(
      `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, home_side, created_by, created_at)
       values ($1, $2, $3::date, $4, $5, $6, $7, $8)`,
      [programId, divisionId, day, lo, hi, side, by, now],
    );
  }
}

const shortDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// The division's teams still playing that day (not taken out or withdrawn), with their games guaranteed.
export function playingTeams(teams: DateTeam[], divisionId: string): DateTeam[] {
  return teams.filter((t) => t.divisionId === divisionId && !t.removedBy && !t.out);
}

// Create (or create again) one division's matchups on one Game Day. Admins and Directors of Scheduling only.
// A team left without an opponent plays TBD, unless it already played TBD this season (then it's listed as short).
// Home and away: see assignHome.
export async function createMatchups(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  day: unknown,
  divisionId: unknown,
  skip: string[] = [], // divisions about to be created again (Create all): their games that day don't count
): Promise<Result<{ created: number; short: string[]; repeats: string[]; tbd: string[] }>> {
  if (!isId(programId) || !isDate(day) || !isId(divisionId)) return { ok: false, message: "Pick a division on a Game Day." };
  if (!(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
  const p = await getProgram(deps, viewer, programId);
  if (!p || p.kind !== "League") return { ok: false, message: "That League wasn't found." };
  const event = teamsByDate(p).find((e) => !e.bracket && e.date === day);
  if (!event) return { ok: false, message: "That isn't one of this League's Game Days." };
  const division = p.divisionList.find((d) => d.id === divisionId);
  if (!division) return { ok: false, message: "That division isn't in this League." };
  const teams = playingTeams(event.teams, divisionId);
  if (!teams.length) return { ok: false, message: `${division.label} has no teams playing that day.` };
  const by = `${viewer.firstName} ${viewer.lastName}`;
  const name = new Map(teams.map((t) => [t.teamId, t.name]));

  return withTx(deps.pool, async (q) => {
    // One Scheduler at a time per League, so two taps can't mix two plans.
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-matchups:' || $1))", [programId]);
    const h = await history(q, programId, day, divisionId, event.teams, skip);
    const plan = planMatchups(
      teams.map((t) => ({
        id: t.teamId,
        need: t.entry!.perDate[day],
        club: t.from,
        grade: t.groupGrade,
        level: t.level,
        hadTbd: h.tbdOn.has(t.teamId),
        coach: h.coach.get(t.teamId),
      })),
      h.met,
      300,
      h.coachOpp,
    );
    // One TBD game for a team left short (never twice in a day), unless it already played TBD this season.
    const tbd = plan.short.filter((x) => !h.tbdOn.has(x.id)).map((x) => x.id);
    const games: { a: string; b: string | null }[] = [
      ...plan.pairs.map(([a, b]) => ({ a, b })),
      ...tbd.map((a) => ({ a, b: null })),
    ];
    const sides = assignHome(games, h.home, h.today, h.coachSide);
    const kept = await keepSlots(q, programId, day, divisionId);
    await q.query("delete from scenic_matchups where program_id = $1 and day = $2::date and division_id = $3", [
      programId,
      day,
      divisionId,
    ]);
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
  const seen = new Set<string>();
  const list: { a: string; b: string | null }[] = [];
  const count = new Map<string, number>();
  for (const g of games as unknown[]) {
    const [a, b] = Array.isArray(g) ? g : [];
    if (!isId(a) || (b !== null && !isId(b))) return { ok: false, message: "Those matchups weren't readable." };
    const ta = teams.get(a);
    const tb = b === null ? null : teams.get(b);
    if (!ta || tb === undefined)
      return { ok: false, message: "A team in those matchups isn't playing in this division that day." };
    if (a === b) return { ok: false, message: `${ta.name} can't play itself.` };
    if (tb && tb.level !== ta.level)
      return {
        ok: false,
        message: `${ta.name} is ${ta.level} and ${tb.name} is ${tb.level}: REC and COMP teams never play each other.`,
      };
    const k = b === null ? `${a}-TBD` : key(a, b);
    if (seen.has(k))
      return { ok: false, message: b === null ? `${ta.name} plays TBD twice.` : `${ta.name} vs ${tb!.name} is in there twice.` };
    seen.add(k);
    list.push({ a, b });
    for (const t of tb ? [ta, tb] : [ta]) {
      count.set(t.teamId, (count.get(t.teamId) ?? 0) + 1);
      const gg = t.entry!.perDate[day];
      if (count.get(t.teamId)! > gg)
        return { ok: false, message: `${t.name} is guaranteed ${gg} game${gg === 1 ? "" : "s"} that day; take it out of one.` };
    }
  }
  const by = `${viewer.firstName} ${viewer.lastName}`;
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-matchups:' || $1))", [programId]);
    const kept = await keepSlots(q, programId, day, divisionId);
    const h = await history(q, programId, day, divisionId, event.teams);
    // A pair kept from before keeps its home side (stored with team_a the lower id).
    const fixed = list.map((g) => {
      const swap = g.b !== null && BigInt(g.b) < BigInt(g.a);
      const side = kept.sides.get(swap ? `${g.b}-${g.a}` : `${g.a}-${g.b ?? "TBD"}`);
      return side ? (swap ? (side === "a" ? "b" : "a") : side) : undefined;
    });
    const sides = assignHome(
      list.map((g, i) => ({ ...g, fixed: fixed[i] })),
      h.home,
      h.today,
      h.coachSide,
    );
    await q.query("delete from scenic_matchups where program_id = $1 and day = $2::date and division_id = $3", [
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
    return { ok: true as const, saved: list.length };
  });
}

// Create all matchups for one Game Day: every League's divisions playing that day, in the League's order, each created again
// as Create matchups does (a coach's teams in an earlier division guide the later ones). Admins and Directors of
// Scheduling only.
export async function createDayMatchups(
  deps: Deps,
  viewer: SessionUser,
  day: unknown,
): Promise<Result<{ created: number; divisions: number; notes: string[] }>> {
  if (!isDate(day)) return { ok: false, message: "Pick a Game Day." };
  if (!(await isScheduler(deps.pool, viewer)))
    return { ok: false, message: "Only a Scenic City Admin or Director of Scheduling can do that." };
  const ids = (
    await deps.pool.query<{ id: string }>(
      "select id::text from scenic_programs where kind = 'League' and ends_on >= $1::date order by starts_on, lower(name)",
      [day],
    )
  ).rows;
  let created = 0;
  let divisions = 0;
  const notes: string[] = [];
  for (const { id } of ids) {
    const p = await getProgram(deps, viewer, id);
    const event = p && teamsByDate(p).find((e) => !e.bracket && e.date === day);
    if (!p || !event) continue;
    const todo = p.divisionList.filter((d) => playingTeams(event.teams, d.id).length);
    for (const [i, d] of todo.entries()) {
      const r = await createMatchups(
        deps,
        viewer,
        id,
        day,
        d.id,
        todo.slice(i + 1).map((x) => x.id),
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
  if (!divisions && !notes.length) return { ok: false, message: "No teams are playing that day." };
  return { ok: true, created, divisions, notes };
}
