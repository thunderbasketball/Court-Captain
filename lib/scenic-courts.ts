// Scenic City Facilities → Courts (SPEC.md section 13): every hosting site's gyms and courts, and which League
// divisions may play on each court. A court with none checked takes every division; once any is checked, the Scheduler
// Grid places only those divisions' games there (checked again on the server in placeGame). Admins and Directors of
// Facilities set them; who set each court's list is recorded.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { isScenicFacilities } from "./scenic";
import { gradeRange } from "./scenic-teams";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

export type CourtRow = { key: string; name: string; divisions: string[]; setBy: string | null };
export type CourtGym = { key: string; name: string; host: string; address: string | null; courts: CourtRow[] };
export type DivisionOption = { id: string; label: string; program: string };

const COURT_KEY = /^(\d{1,18}|o\d{1,18}-(\d{1,18}|gym))$/;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);

// Every court that can host games, keyed as on the Scheduler Grid: partners' own courts, and approved hosting
// organizations' active gyms (their courts, not practice goals; a gym with none is one court, Main).
async function allCourts(q: Queryable) {
  return (
    await q.query<{ gymKey: string; gym: string; host: string; address: string | null; key: string; court: string }>(
      `select 'p' || g.id as "gymKey", g.name as gym, p.name as host, g.address, c.id::text as key, c.name as court
         from partner_courts c join partner_gyms g on g.id = c.gym_id join partners p on p.id = g.partner_id
        where p.org_slug is null
       union all
       select 'o' || g.id, g.name, p.name, null, 'o' || g.id || '-' || coalesce(c.id::text, 'gym'), coalesce(c.name, 'Main')
         from gyms g join partners p on p.org_slug = g.org and p.approved and p.hosts_games
         left join courts c on c.gym_id = g.id and c.name !~* '^goal'
        where g.active
       order by 3, 2, 6`,
    )
  ).rows;
}

// The current Leagues' divisions (not ended), Boys then Girls, youngest first.
async function currentDivisions(q: Queryable, today: string): Promise<DivisionOption[]> {
  const r = await q.query<{ id: string; gender: string; low: number; high: number; program: string }>(
    `select d.id::text, d.gender, d.grade_low as low, d.grade_high as high, p.name as program
       from scenic_divisions d join scenic_programs p on p.id = d.program_id
      where p.kind = 'League' and p.ends_on >= $1::date
      order by p.starts_on, lower(p.name), d.grade_low = -1 desc, d.gender, d.grade_low`,
    [today],
  );
  return r.rows.map((d) => ({ id: d.id, label: `${d.gender} ${gradeRange(d.low, d.high)}`, program: d.program }));
}

// Facilities → Courts: the gyms with their courts and each court's divisions, and the divisions to pick from. Admins
// and Directors of Facilities only (null for anyone else).
export async function listCourts(
  deps: Deps,
  viewer: SessionUser,
): Promise<{ gyms: CourtGym[]; divisions: DivisionOption[] } | null> {
  if (!(await isScenicFacilities(deps.pool, viewer.coachId))) return null;
  const [courts, divisions, set] = await Promise.all([
    allCourts(deps.pool),
    currentDivisions(deps.pool, easternDate(deps.now())),
    deps.pool.query<{ key: string; division: string; by: string }>(
      `select court_key as key, division_id::text as division, set_by as by from scenic_court_divisions order by set_at`,
    ),
  ]);
  const current = new Set(divisions.map((d) => d.id));
  const gyms = new Map<string, CourtGym>();
  for (const r of courts) {
    const g = gyms.get(r.gymKey) ?? { key: r.gymKey, name: r.gym, host: r.host, address: r.address, courts: [] };
    const rows = set.rows.filter((x) => x.key === r.key && current.has(x.division));
    g.courts.push({ key: r.key, name: r.court, divisions: rows.map((x) => x.division), setBy: rows.at(-1)?.by ?? null });
    gyms.set(r.gymKey, g);
  }
  for (const g of gyms.values()) g.courts.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { gyms: [...gyms.values()], divisions };
}

// Set which divisions may play on a court (none: every division). Admins and Directors of Facilities only. Only the
// current Leagues' divisions can be picked; past Leagues' picks for the court are left alone.
export async function setCourtDivisions(
  deps: Deps,
  viewer: SessionUser,
  courtKey: unknown,
  divisionIds: unknown,
): Promise<Result<{ divisions: number }>> {
  if (typeof courtKey !== "string" || !COURT_KEY.test(courtKey)) return { ok: false, message: "Pick a court." };
  if (!Array.isArray(divisionIds) || divisionIds.length > 200 || !divisionIds.every(isId))
    return { ok: false, message: "Those divisions weren't readable." };
  if (!(await isScenicFacilities(deps.pool, viewer.coachId)))
    return { ok: false, message: "Only a Scenic City Admin or Director of Facilities can do that." };
  if (!(await allCourts(deps.pool)).some((c) => c.key === courtKey))
    return { ok: false, message: "That court isn't hosting games." };
  const current = await currentDivisions(deps.pool, easternDate(deps.now()));
  const ids = [...new Set(divisionIds as string[])];
  if (!ids.every((id) => current.some((d) => d.id === id)))
    return { ok: false, message: "A division isn't in a current League." };
  const by = `${viewer.firstName} ${viewer.lastName}`;
  return withTx(deps.pool, async (q) => {
    await q.query("delete from scenic_court_divisions where court_key = $1 and division_id = any($2::bigint[])", [
      courtKey,
      current.map((d) => d.id),
    ]);
    if (ids.length)
      await q.query(
        `insert into scenic_court_divisions (court_key, division_id, set_by, set_at)
         select $1, unnest($2::bigint[]), $3, $4`,
        [courtKey, ids, by, deps.now()],
      );
    return { ok: true as const, divisions: ids.length };
  });
}

// For the Grid on a Game Day: each court with divisions set (in Leagues still running that day) → the division ids
// allowed there. Courts not listed take any division.
export async function courtDivisions(q: Queryable, day: string): Promise<Map<string, string[]>> {
  const r = await q.query<{ key: string; ids: string[] }>(
    `select x.court_key as key, array_agg(x.division_id::text) as ids
       from scenic_court_divisions x join scenic_divisions d on d.id = x.division_id
       join scenic_programs p on p.id = d.program_id
      where p.ends_on >= $1::date
      group by x.court_key`,
    [day],
  );
  return new Map(r.rows.map((x) => [x.key, x.ids]));
}
