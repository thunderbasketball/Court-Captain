// Simulation mode (development only, temporary): simulated teams for building the Scheduler. Turning it on fills the
// current League with 0–2 random teams per grade (Boys and Girls; 125 teams at most) from every organization except Scenic City, named
// "<abbr> <grade><B|G> <name> (DEV)", each registered ALL Season. Grades with COMP pick COMP or REC at random; K–1st are
// REC. They're Scenic City teams under the organization's partner (its gyms are their home gyms), not on the
// organization's own Teams page. Each has a made-up Head Coach (a name only, no login); about a third of an
// organization's teams share a coach with 1 or 2 of its other teams, in different grades. Turning it off deletes every "(DEV)" team with its registrations, matchups and grid
// slots. Admins and Directors of Scheduling only.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { isScheduler } from "./scenic-programs";
import { withTx } from "./sql";

type Deps = { pool: Pool; now: () => Date; random?: () => number };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const NAMES = ["Hawks", "Lions", "Bears"];
const FIRST = ["Alex", "Jordan", "Casey", "Taylor", "Morgan", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Reese", "Blake"];
const LAST = [
  "Adams",
  "Brooks",
  "Carter",
  "Dixon",
  "Ellis",
  "Foster",
  "Grant",
  "Hayes",
  "Irwin",
  "Jensen",
  "Keller",
  "Lowe",
  "Mason",
  "Nolan",
  "Owens",
  "Price",
  "Reed",
  "Shaw",
  "Tate",
  "Vance",
  "Wells",
  "Young",
];
const MAX = 125; // simulated teams at most
const DEV = "% (DEV)";
const schedulerOnly = { ok: false as const, message: "Only a Scenic City Admin or Director of Scheduling can do that." };

// How many simulated teams there are now (0: Simulation mode is off).
export async function simulatedTeams(pool: Pick<Pool, "query">): Promise<number> {
  return (await pool.query<{ n: number }>("select count(*)::int as n from scenic_teams where name like $1", [DEV])).rows[0].n;
}

// Turn Simulation mode on (a new random set, replacing any there) or off (none).
export async function setSimulation(deps: Deps, viewer: SessionUser, on: boolean): Promise<Result<{ teams: number }>> {
  if (!(await isScheduler(deps.pool, viewer))) return schedulerOnly;
  const rand = deps.random ?? Math.random;
  const by = `${viewer.firstName} ${viewer.lastName}`;
  return withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('scenic-simulation'))");
    await q.query("delete from scenic_teams where name like $1", [DEV]);
    if (!on) return { ok: true as const, teams: 0 };
    const league = (
      await q.query<{ id: string }>(
        "select id::text from scenic_programs where kind = 'League' and ends_on >= $1::date order by starts_on, id limit 1",
        [deps.now().toISOString().slice(0, 10)],
      )
    ).rows[0];
    if (!league) return { ok: false as const, message: "There's no current League to fill." };
    const orgs = (
      await q.query<{ abbr: string; partner: string }>(
        `select coalesce(o.abbr, o.short_name) as abbr, p.id::text as partner
           from organizations o join partners p on p.org_slug = o.slug where o.slug <> 'scenic-city' order by o.name`,
      )
    ).rows;
    const grades = (
      await q.query<{ gender: string; grade: number; comp: boolean }>(
        `select d.gender, g.grade, bool_or(g.level = 'COMP') as comp
           from scenic_divisions d join scenic_grade_groups g on g.division_id = d.id where d.program_id = $1
          group by 1, 2 order by 1, 2`,
        [league.id],
      )
    ).rows;
    const rows: {
      name: string;
      gender: string;
      grade: number;
      level: string;
      partner: string;
      coach_first?: string;
      coach_last?: string;
    }[] = [];
    for (const o of orgs)
      for (const g of grades) {
        const n = Math.floor(rand() * 3); // 0, 1 or 2
        for (let i = 0; i < n; i++)
          rows.push({
            name: `${o.abbr} ${g.grade === -1 ? "PK" : g.grade === 0 ? "K" : g.grade}${g.gender[0]} ${NAMES[i]} (DEV)`,
            gender: g.gender,
            grade: g.grade,
            level: g.comp && rand() < 0.5 ? "COMP" : "REC",
            partner: o.partner,
          });
      }
    // At most 125: drop teams at random until it fits.
    while (rows.length > MAX) rows.splice(Math.floor(rand() * rows.length), 1);
    if (!rows.length) return { ok: true as const, teams: 0 };
    // Coaches: within each organization, coaches with 2 or 3 teams in different grades (about a third of its teams),
    // then one coach for each team left. Names are different within an organization.
    for (const partner of new Set(rows.map((r) => r.partner))) {
      const left = rows.filter((r) => r.partner === partner).sort(() => rand() - 0.5);
      const used = new Set<string>();
      const all = FIRST.length * LAST.length;
      const coach = () => {
        // A random name, or the next one not used yet.
        const start = Math.floor(rand() * all);
        for (let i = 0; i < all; i++) {
          const n = (start + i * 7) % all; // 7 shares no factor with 264, so this visits every name
          const [f, l] = [FIRST[n % FIRST.length], LAST[Math.floor(n / FIRST.length)]];
          if (!used.has(`${f} ${l}`)) return (used.add(`${f} ${l}`), [f, l] as const);
        }
        return [FIRST[0], LAST[0]] as const;
      };
      let shared = 0;
      while (shared < left.length / 3) {
        const team: typeof rows = [];
        const want = rand() < 0.5 ? 2 : 3;
        for (const r of left) if (team.length < want && !team.some((x) => x.grade === r.grade)) team.push(r);
        if (team.length < 2) break;
        const [f, l] = coach();
        for (const r of team) {
          [r.coach_first, r.coach_last] = [f, l];
          left.splice(left.indexOf(r), 1);
        }
        shared += team.length;
      }
      for (const r of left) [r.coach_first, r.coach_last] = coach();
    }
    // All at once: the teams, then each one's registration in its grade group's smallest pool.
    const ids = await q.query<{ id: string }>(
      `insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, coach_first, coach_last,
                                 created_by, created_at, updated_by, updated_at)
       select x.name, x.gender, x.grade, x.grade, x.level, x.partner, x.coach_first, x.coach_last, $2, $3, $2, $3
         from jsonb_to_recordset($1::jsonb)
           as x(name text, gender text, grade int, level text, partner bigint, coach_first text, coach_last text)
       returning id::text`,
      [JSON.stringify(rows), by, deps.now()],
    );
    await q.query(
      `insert into scenic_registrations (program_id, team_id, pool_id, registered_by, registered_at, all_season)
       select $1, t.id, o.id, $3, $4, true
         from scenic_teams t
         cross join lateral (
           select o.id from scenic_pools o join scenic_grade_groups g on g.id = o.group_id join scenic_divisions d on d.id = g.division_id
            where d.program_id = $1 and d.gender = t.gender and g.grade = t.grade and g.level = t.level
            order by (select count(*) from scenic_registrations r where r.pool_id = o.id), o.id limit 1) o
        where t.id = any($2::bigint[])`,
      [league.id, ids.rows.map((r) => r.id), by, deps.now()],
    );
    return { ok: true as const, teams: ids.rows.length };
  });
}
