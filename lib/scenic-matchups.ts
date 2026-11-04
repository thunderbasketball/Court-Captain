// Scenic City Scheduler: matchups (SPEC.md section 13, step 7). For one division on one Game Day, Admins and Directors
// of Scheduling tap Create matchups: the division's teams playing that day are paired, each getting its games
// guaranteed (1GG = one game, 2GG = two), never the same pair twice that day. Pairs that already met on the League's
// other Game Days are avoided first, then teams from the same club, then teams from different grade groups.
// Creating again replaces that division's matchups for the day.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { getProgram, isScheduler, teamsByDate, type DateTeam } from "./scenic-programs";
import { withTx } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type MatchTeam = { id: string; need: number; club: string; grade: number; level: string };
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

// Pairs teams for one day. `met`: how many times each pair (key a-b) already played on other days.
// Tries many orders and keeps the plan with the fewest games missing, then the lowest cost.
export function planMatchups(teams: MatchTeam[], met: Map<string, number>, tries = 300): Plan {
  const cost = (a: MatchTeam, b: MatchTeam) =>
    (met.get(key(a.id, b.id)) ?? 0) * 1000 +
    (a.club === b.club ? 100 : 0) +
    Math.abs(a.grade - b.grade) * 20 +
    (a.level === b.level ? 0 : 10);
  const rand = random(teams.length * 7919 + 17);
  let best: { pairs: [string, string][]; missing: number; cost: number; need: Map<string, number> } | null = null;
  for (let t = 0; t < tries; t++) {
    const order = teams
      .map((x) => ({ x, r: rand() }))
      .sort((p, q) => p.r - q.r)
      .map((p) => p.x);
    const need = new Map(order.map((x) => [x.id, x.need]));
    const today = new Set<string>();
    const pairs: [string, string][] = [];
    let total = 0;
    for (;;) {
      const open = order.filter((x) => need.get(x.id)! > 0);
      const options = (a: MatchTeam) => open.filter((b) => b.id !== a.id && !today.has(key(a.id, b.id)));
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
    }
    const missing = [...need.values()].reduce((n, v) => n + v, 0);
    if (!best || missing < best.missing || (missing === best.missing && total < best.cost))
      best = { pairs, missing, cost: total, need };
    if (best.missing <= 1 && best.cost === 0) break;
  }
  return {
    pairs: best?.pairs ?? [],
    short: best ? teams.filter((x) => best.need.get(x.id)! > 0).map((x) => ({ id: x.id, games: best.need.get(x.id)! })) : [],
  };
}

// Games keep their grid slot when a division's matchups are saved or created again: the same pair stays where it was.
async function keepSlots(q: PoolClient, programId: string, day: string, divisionId: string) {
  const r = await q.query<{ a: string; b: string; court: string; starts: string; by: string; at: Date }>(
    `select team_a::text as a, team_b::text as b, court_key as court, starts::text, placed_by as by, placed_at as at
       from scenic_matchups where program_id = $1 and day = $2::date and division_id = $3 and court_key is not null`,
    [programId, day, divisionId],
  );
  return async () => {
    for (const x of r.rows)
      await q.query(
        `update scenic_matchups set court_key = $5, starts = $6::time, placed_by = $7, placed_at = $8
          where program_id = $1 and day = $2::date and team_a = $3 and team_b = $4`,
        [programId, day, x.a, x.b, x.court, x.starts, x.by, x.at],
      );
  };
}

// The division's teams still playing that day (not taken out or withdrawn), with their games guaranteed.
export function playingTeams(teams: DateTeam[], divisionId: string): DateTeam[] {
  return teams.filter((t) => t.divisionId === divisionId && !t.removedBy && !t.out);
}

// Create (or create again) one division's matchups on one Game Day. Admins and Directors of Scheduling only.
export async function createMatchups(
  deps: Deps,
  viewer: SessionUser,
  programId: unknown,
  day: unknown,
  divisionId: unknown,
): Promise<Result<{ created: number; short: string[]; repeats: string[] }>> {
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
  if (teams.length < 2) return { ok: false, message: `${division.label} needs at least 2 teams playing that day.` };
  const by = `${viewer.firstName} ${viewer.lastName}`;
  const name = new Map(teams.map((t) => [t.teamId, t.name]));

  return withTx(deps.pool, async (q) => {
    // One Scheduler at a time per League, so two taps can't mix two plans.
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-matchups:' || $1))", [programId]);
    const before = await q.query<{ a: string; b: string; day: string }>(
      `select team_a::text as a, team_b::text as b, day::text from scenic_matchups where program_id = $1 and day <> $2::date`,
      [programId, day],
    );
    const met = new Map<string, number>();
    const metOn = new Map<string, string[]>();
    for (const r of before.rows) {
      met.set(key(r.a, r.b), (met.get(key(r.a, r.b)) ?? 0) + 1);
      metOn.set(key(r.a, r.b), [...(metOn.get(key(r.a, r.b)) ?? []), r.day].sort());
    }
    const plan = planMatchups(
      teams.map((t) => ({ id: t.teamId, need: t.entry!.perDate[day], club: t.from, grade: t.groupGrade, level: t.level })),
      met,
    );
    const restore = await keepSlots(q, programId, day, divisionId);
    await q.query("delete from scenic_matchups where program_id = $1 and day = $2::date and division_id = $3", [
      programId,
      day,
      divisionId,
    ]);
    for (const [a, b] of plan.pairs) {
      const [lo, hi] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
      await q.query(
        `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by, created_at)
         values ($1, $2, $3::date, $4, $5, $6, $7)`,
        [programId, divisionId, day, lo, hi, by, deps.now()],
      );
    }
    await restore();
    return {
      ok: true as const,
      created: plan.pairs.length,
      short: plan.short.map((s) => `${name.get(s.id)} needs ${s.games} more game${s.games === 1 ? "" : "s"}`),
      repeats: plan.pairs
        .filter(([a, b]) => met.has(key(a, b)))
        .map(([a, b]) => `${name.get(a)} vs ${name.get(b)} (also ${metOn.get(key(a, b))!.join(", ")})`),
    };
  });
}

// Save one division's matchups on one Game Day as the Scheduler arranged them (drag and drop). Admins and Directors of
// Scheduling only. Every game is checked again here: both teams in this division and still playing that day, not the
// same team twice, no pair twice that day, and no team in more games than it's guaranteed. Replaces that division's
// matchups for the day; teams left out stay in the Sandbox (short).
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
  const pairs = new Set<string>();
  const count = new Map<string, number>();
  for (const g of games as unknown[]) {
    const [a, b] = Array.isArray(g) ? g : [];
    if (!isId(a) || !isId(b)) return { ok: false, message: "Those matchups weren't readable." };
    const ta = teams.get(a);
    const tb = teams.get(b);
    if (!ta || !tb) return { ok: false, message: "A team in those matchups isn't playing in this division that day." };
    if (a === b) return { ok: false, message: `${ta.name} can't play itself.` };
    if (pairs.has(key(a, b))) return { ok: false, message: `${ta.name} vs ${tb.name} is in there twice.` };
    pairs.add(key(a, b));
    for (const t of [ta, tb]) {
      count.set(t.teamId, (count.get(t.teamId) ?? 0) + 1);
      const gg = t.entry!.perDate[day];
      if (count.get(t.teamId)! > gg)
        return { ok: false, message: `${t.name} is guaranteed ${gg} game${gg === 1 ? "" : "s"} that day; take it out of one.` };
    }
  }
  const by = `${viewer.firstName} ${viewer.lastName}`;
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-matchups:' || $1))", [programId]);
    const restore = await keepSlots(q, programId, day, divisionId);
    await q.query("delete from scenic_matchups where program_id = $1 and day = $2::date and division_id = $3", [
      programId,
      day,
      divisionId,
    ]);
    for (const k of pairs) {
      const [lo, hi] = k.split("-");
      await q.query(
        `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by, created_at)
         values ($1, $2, $3::date, $4, $5, $6, $7)`,
        [programId, divisionId, day, lo, hi, by, deps.now()],
      );
    }
    await restore();
    return { ok: true as const, saved: pairs.size };
  });
}
