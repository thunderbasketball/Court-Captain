// An organization's teams in a league's programs (SPEC.md section 14). No approval needed: the organization's Admins and
// Directors of Teams (with Team Management) register its teams into the league's open programs, one at a time or all
// unregistered ones at once. Each team gets a copy in Scenic City (under the organization's partner record, made on its
// first registration; read-only there), placed in the smallest pool of its matching grade group, like any Scenic City
// team. Programs are Scenic City's (the only league so far).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { orgName, orgShort } from "./org-registry";
import { teamsManagerOf } from "./org-teams";
import type { OrgSlug } from "./orgs";
import { leagueEntry, programRegStatus, saveChoice, type Entry, type ProgramOption, type RegStatus } from "./scenic-programs";
import { gradeLabel, gradeRange } from "./scenic-teams";
import { withTx, type Queryable } from "./sql";
import { easternDate } from "./time";

type Deps = { pool: Pool; now: () => Date };
type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

const LEAGUE = "scenic-city";
const by = (v: SessionUser) => `${v.firstName} ${v.lastName}`;
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
const regOpen = (today: string, opens: string, closes: string): RegStatus =>
  today < opens ? "upcoming" : today > closes ? "closed" : "open";

// The organization's partner record in Scenic City (made the first time it registers a team; it registers teams).
async function partnerFor(q: Pick<Queryable, "query">, org: OrgSlug, byName: string): Promise<string> {
  const name = await orgName(q, org);
  const found = await q.query<{ id: string }>(
    `select id::text from partners where org_slug = $1
     union all select id::text from partners where org_slug is null and lower(name) = lower($2)
     limit 1`,
    [org, name],
  );
  if (found.rows[0]) {
    await q.query("update partners set org_slug = $2, registers_teams = true, approved = true where id = $1", [
      found.rows[0].id,
      org,
    ]);
    return found.rows[0].id;
  }
  const ins = await q.query<{ id: string }>(
    `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug)
     values ($1, 'Organization', false, true, true, $2, $3) returning id::text`,
    [name, byName, org],
  );
  return ins.rows[0].id;
}

// The team's copy in Scenic City, made or brought up to date (its Head Coach, or none yet: added later, copied then).
async function copyOf(q: Pick<Queryable, "query">, orgTeamId: string, partnerId: string, byName: string, now: Date) {
  const r = await q.query<{ id: string }>(
    `insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, coach_id, created_by, created_at, updated_by, updated_at, org_team_id)
     select t.name, t.gender, t.grade_low, t.grade, t.level, $2, c.coach_id, $3, $4, $3, $4, t.id
     from org_teams t left join org_team_coaches c on c.team_id = t.id and c.role = 'HeadCoach' where t.id = $1
     on conflict (org_team_id) do update set name = excluded.name, gender = excluded.gender, grade_low = excluded.grade_low,
       grade = excluded.grade, level = excluded.level, partner_id = excluded.partner_id, coach_id = excluded.coach_id
     returning id::text`,
    [orgTeamId, partnerId, byName, now],
  );
  return r.rows[0].id;
}

// ---- The organization's Teams page: the league's programs, and how many of its teams are in each ----

export type OrgProgram = {
  id: string;
  kind: string;
  name: string;
  startsOn: string;
  endsOn: string;
  regCloses: string;
  feeCents: number | null;
  status: RegStatus;
  registered: number; // of this organization's teams
  unregistered: number; // its teams not in it yet
};

export async function orgPrograms(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
): Promise<{ league: string; programs: OrgProgram[] } | null> {
  const o = await teamsManagerOf(deps.pool, viewer, org);
  if (!o || !(await hasFeature(deps.pool, LEAGUE, "programs"))) return null;
  const today = easternDate(deps.now());
  const r = await deps.pool.query<Omit<OrgProgram, "status"> & { regOpens: string }>(
    `select p.id::text, p.kind, p.name, p.starts_on::text as "startsOn", p.ends_on::text as "endsOn",
            p.reg_opens::text as "regOpens", p.reg_closes::text as "regCloses", p.fee_cents as "feeCents",
            count(r.team_id)::int as registered, (count(t.id) - count(r.team_id))::int as unregistered
     from scenic_programs p
     left join org_teams t on t.org = $1
     left join scenic_teams st on st.org_team_id = t.id
     left join scenic_registrations r on r.program_id = p.id and r.team_id = st.id
     where p.reg_closes >= $2::date
     group by p.id order by p.starts_on, lower(p.name)`,
    [o, today],
  );
  return {
    league: await orgShort(deps.pool, LEAGUE),
    programs: r.rows.map(({ regOpens, ...p }) => ({ ...p, status: regOpen(today, regOpens, p.regCloses) })),
  };
}

// ---- A team's programs ----

export type TeamProgram = {
  id: string;
  kind: string;
  name: string;
  startsOn: string;
  endsOn: string;
  regCloses: string;
  feeCents: number | null;
  status: RegStatus;
  fits: boolean; // has a grade group for this team's gender, grade and level
  // `removedBy`: taken out of the whole program; `off`: Game Days (YYYY-MM-DD) or "brackets" it was taken out of → by whom.
  // `teamOff`: the ones the team withdrew from itself (it can re-enter them).
  registered: {
    where: string;
    by: string;
    paid: boolean;
    removedBy: string | null;
    off: Record<string, string>;
    teamOff: string[];
  } | null;
  // A League: its options and Game Days, and what this team registered for.
  options: ProgramOption[];
  gameDates: string[];
  entry: Entry | null;
};

// For the team's page: the league's programs this team can register for (registration open, upcoming) or is in.
// Coaches see it; managers register.
export async function teamPrograms(
  deps: Deps,
  viewer: SessionUser,
  org: OrgSlug,
  orgTeamId: string,
): Promise<{ league: string; canRegister: boolean; programs: TeamProgram[] } | null> {
  if (!(await hasFeature(deps.pool, LEAGUE, "programs"))) return null;
  const [manager, league] = await Promise.all([teamsManagerOf(deps.pool, viewer, org), orgShort(deps.pool, LEAGUE)]);
  const r = await deps.pool.query<{
    id: string;
    kind: string;
    name: string;
    startsOn: string;
    endsOn: string;
    regOpens: string;
    regCloses: string;
    feeCents: number | null;
    fits: boolean;
    pool: string | null;
    gender: string | null;
    low: number | null;
    high: number | null;
    grade: number | null;
    level: string | null;
    regBy: string | null;
    paid: boolean | null;
    removedBy: string | null;
    off: Record<string, string>;
    teamOff: string[];
  }>(
    `select p.id::text, p.kind, p.name, p.starts_on::text as "startsOn", p.ends_on::text as "endsOn",
            p.reg_opens::text as "regOpens", p.reg_closes::text as "regCloses", p.fee_cents as "feeCents",
            exists (select 1 from scenic_divisions d join scenic_grade_groups g on g.division_id = d.id
                    where d.program_id = p.id and d.gender = t.gender and g.grade = t.grade and g.level = t.level) as fits,
            o.name as pool, d.gender, d.grade_low as low, d.grade_high as high, g.grade, g.level,
            r.registered_by as "regBy", r.paid, r.removed_by as "removedBy",
            coalesce((select json_object_agg(x.off, x.set_by) from scenic_team_off x
                      where x.program_id = r.program_id and x.team_id = r.team_id), '{}') as off,
            array(select x.off from scenic_team_off x
                  where x.program_id = r.program_id and x.team_id = r.team_id and x.by_team) as "teamOff"
     from org_teams t
     cross join scenic_programs p
     left join scenic_teams st on st.org_team_id = t.id
     left join scenic_registrations r on r.program_id = p.id and r.team_id = st.id
     left join scenic_pools o on o.id = r.pool_id
     left join scenic_grade_groups g on g.id = o.group_id
     left join scenic_divisions d on d.id = g.division_id
     where t.id = $1 and t.org = $2 and (r.team_id is not null or p.reg_closes >= $3::date)
     order by p.starts_on, lower(p.name)`,
    [orgTeamId, org, easternDate(deps.now())],
  );
  const today = easternDate(deps.now());
  const copy = (await deps.pool.query<{ id: string }>("select id::text from scenic_teams where org_team_id = $1", [orgTeamId]))
    .rows[0]?.id;
  const terms = new Map(
    await Promise.all(
      r.rows.map(async (p) => [p.id, p.kind === "League" ? await leagueEntry(deps.pool, p.id, copy ?? null) : null] as const),
    ),
  );
  return {
    league,
    canRegister: !!manager,
    programs: r.rows.map((p) => ({
      options: terms.get(p.id)?.options ?? [],
      gameDates: terms.get(p.id)?.gameDates ?? [],
      entry: terms.get(p.id)?.entry ?? null,
      id: p.id,
      kind: p.kind,
      name: p.name,
      startsOn: p.startsOn,
      endsOn: p.endsOn,
      regCloses: p.regCloses,
      feeCents: p.feeCents,
      status: regOpen(today, p.regOpens, p.regCloses),
      fits: p.fits,
      registered: p.pool
        ? {
            where: `${p.gender} ${gradeRange(p.low!, p.high!)} · ${gradeLabel(p.grade!, p.grade!)} ${p.level} · ${p.pool}`,
            by: p.regBy!,
            paid: !!p.paid,
            removedBy: p.removedBy,
            off: p.off,
            teamOff: p.teamOff ?? [],
          }
        : null,
    })),
  };
}

// Register the team into a program while its registration is open (its coach can come later).
export async function registerOrgTeam(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  orgTeamId: unknown,
  programId: unknown,
  choice?: unknown, // a League: what it registers for (adds to an earlier registration)
): Promise<Result<{ division: string | null; entry: Entry | null }>> {
  if (!isId(orgTeamId) || !isId(programId)) return { ok: false, message: "Pick a team and a program." };
  const o = await teamsManagerOf(deps.pool, viewer, org);
  if (!o) return { ok: false, message: "Only an Admin or Director of Teams can register teams." };
  return withTx(deps.pool, async (q) => {
    const status = await programRegStatus(q, programId, deps.now());
    if (!status) return { ok: false as const, message: "That program no longer exists." };
    if (status !== "open") return { ok: false as const, message: "Registration isn't open for this program." };
    const t = await q.query("select 1 from org_teams where id = $1 and org = $2 for update", [orgTeamId, o]);
    if (!t.rowCount) return { ok: false as const, message: "That team no longer exists." };
    const copy = await copyOf(q, orgTeamId, await partnerFor(q, o, by(viewer)), by(viewer), deps.now());
    const placed = await saveChoice(q, programId, copy, choice, by(viewer), deps.now());
    return "error" in placed ? { ok: false as const, message: placed.error } : { ok: true as const, ...placed };
  });
}

// Register every team of the organization not in the program yet, each into its matching division (smallest pool).
// Teams with no division for their gender, grade and level are skipped and say why. A team needs no coach yet.
export async function registerAllOrgTeams(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  programId: unknown,
): Promise<Result<{ registered: string[]; skipped: string[] }>> {
  if (!isId(programId)) return { ok: false, message: "Pick a program." };
  const o = await teamsManagerOf(deps.pool, viewer, org);
  if (!o) return { ok: false, message: "Only an Admin or Director of Teams can register teams." };
  return withTx(deps.pool, async (q) => {
    const status = await programRegStatus(q, programId, deps.now());
    if (!status) return { ok: false as const, message: "That program no longer exists." };
    if (status !== "open") return { ok: false as const, message: "Registration isn't open for this program." };
    const teams = await q.query<{ id: string; name: string }>(
      `select t.id::text, t.name from org_teams t
       where t.org = $1 and not exists (select 1 from scenic_teams st join scenic_registrations r on r.team_id = st.id
                                        where st.org_team_id = t.id and r.program_id = $2)
       order by t.gender, t.grade, lower(t.name) for update`,
      [o, programId],
    );
    const partnerId = await partnerFor(q, o, by(viewer));
    const registered: string[] = [];
    const skipped: string[] = [];
    for (const t of teams.rows) {
      const copy = await copyOf(q, t.id, partnerId, by(viewer), deps.now());
      // All at once: ALL Season (Single Days are picked on each team's page).
      const placed = await saveChoice(q, programId, copy, { allSeason: true, days: [] }, by(viewer), deps.now());
      if ("error" in placed) skipped.push(`${t.name}: ${placed.error}`);
      else registered.push(`${t.name}: ${placed.division}`);
    }
    return { ok: true as const, registered, skipped };
  });
}

// The team withdraws from one of its upcoming dates (or the Brackets), or re-enters one it withdrew from (`out` false).
// Its registration and fee stay. A date Scenic City took it out of is restored only by Scenic City.
export async function setOrgTeamDayOff(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  orgTeamId: unknown,
  programId: unknown,
  what: unknown,
  out: boolean,
): Promise<Result> {
  if (!isId(orgTeamId) || !isId(programId)) return { ok: false, message: "Pick a team and a program." };
  const isDay = typeof what === "string" && /^\d{4}-\d{2}-\d{2}$/.test(what);
  if (what !== "brackets" && !isDay) return { ok: false, message: "Pick a date." };
  const o = await teamsManagerOf(deps.pool, viewer, org);
  if (!o) return { ok: false, message: "Only an Admin or Director of Teams can change this." };
  return withTx(deps.pool, async (q) => {
    const st = await q.query<{ id: string }>(
      `select st.id::text from scenic_teams st join org_teams t on t.id = st.org_team_id
       join scenic_registrations r on r.team_id = st.id and r.program_id = $3
       where t.id = $1 and t.org = $2 for update of r`,
      [orgTeamId, o, programId],
    );
    const teamId = st.rows[0]?.id;
    if (!teamId) return { ok: false as const, message: "That team isn't registered." };
    const { entry } = await leagueEntry(q, programId, teamId);
    if (isDay) {
      if (!entry?.perDate[what as string]) return { ok: false as const, message: "The team isn't registered for that date." };
      if ((what as string) < easternDate(deps.now())) return { ok: false as const, message: "That date has passed." };
    } else if (!entry?.bracket) return { ok: false as const, message: "The team isn't in the Brackets." };
    const now = await q.query<{ by_team: boolean }>(
      "select by_team from scenic_team_off where program_id = $1 and team_id = $2 and off = $3",
      [programId, teamId, what],
    );
    if (out) {
      if (now.rowCount) return { ok: true as const };
      await q.query(
        `insert into scenic_team_off (program_id, team_id, off, set_by, set_at, by_team) values ($1, $2, $3, $4, $5, true)`,
        [programId, teamId, what, by(viewer), deps.now()],
      );
      return { ok: true as const };
    }
    if (now.rows[0] && !now.rows[0].by_team)
      return {
        ok: false as const,
        message: `${await orgShort(q, LEAGUE)} took the team out of that date. Ask a ${await orgShort(q, LEAGUE)} Director of Scheduling.`,
      };
    await q.query("delete from scenic_team_off where program_id = $1 and team_id = $2 and off = $3", [programId, teamId, what]);
    return { ok: true as const };
  });
}

// Take the team out while registration is open (after that, the league's Directors of Programs can).
export async function withdrawOrgTeam(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  orgTeamId: unknown,
  programId: unknown,
): Promise<Result> {
  if (!isId(orgTeamId) || !isId(programId)) return { ok: false, message: "Pick a team and a program." };
  const o = await teamsManagerOf(deps.pool, viewer, org);
  if (!o) return { ok: false, message: "Only an Admin or Director of Teams can withdraw teams." };
  return withTx(deps.pool, async (q) => {
    const status = await programRegStatus(q, programId, deps.now());
    if (!status) return { ok: false as const, message: "That program no longer exists." };
    if (status !== "open")
      return { ok: false as const, message: `Registration is closed. Ask a ${await orgShort(q, LEAGUE)} Director of Programs.` };
    const r = await q.query(
      `delete from scenic_registrations r using scenic_teams st, org_teams t
       where r.program_id = $1 and r.team_id = st.id and st.org_team_id = t.id and t.id = $2 and t.org = $3`,
      [programId, orgTeamId, o],
    );
    return r.rowCount ? { ok: true as const } : { ok: false as const, message: "That team isn't registered." };
  });
}
