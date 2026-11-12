// Team warnings (SPEC.md section 14, Teams card → Warnings): each organization turns on the ones it wants and sets their
// numbers in the organization gear's Warnings card (its Admins): rosters with fewer than n players, teams whose staff haven't used the
// app in n days, and (where uniforms are kept: Thunder) teams with uniform numbers or sizes missing.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { hasFeature } from "./features";
import { isOrgAdmin } from "./org-admin";
import type { Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };

import { IDLE_DAYS, ROSTER_MIN, cleanWarnings, DEFAULT_WARNINGS, type WarningSettings } from "./team-warnings-fields";

export { cleanWarnings, DEFAULT_WARNINGS, IDLE_DAYS, ROSTER_MIN, type WarningSettings };

export type WarnedTeam = { id: string; name: string; detail: string };
export type TeamWarnings = {
  settings: WarningSettings;
  setBy: string | null;
  uniformsKept: boolean; // the organization keeps uniform numbers and sizes (Thunder with Uniforms)
  roster: WarnedTeam[] | null; // null = turned off
  idle: WarnedTeam[] | null;
  uniforms: WarnedTeam[] | null;
  teams: number; // teams with any warning
};

// Just the settings (the organization gear's Warnings card): what's on, their numbers, who set them.
export async function teamWarningSettings(
  q: Pick<Queryable, "query">,
  org: string,
): Promise<{ settings: WarningSettings; setBy: string | null; uniformsKept: boolean }> {
  const [o, uniformsKept] = await Promise.all([
    q.query<{ team_warnings: unknown; team_warnings_by: string | null }>(
      "select team_warnings, team_warnings_by from organizations where slug = $1",
      [org],
    ),
    org === "thunder" ? hasFeature(q, org, "uniforms") : Promise.resolve(false),
  ]);
  return {
    settings: cleanWarnings(o.rows[0]?.team_warnings) ?? DEFAULT_WARNINGS,
    setBy: o.rows[0]?.team_warnings_by ?? null,
    uniformsKept,
  };
}

export async function orgTeamWarnings(q: Pick<Queryable, "query">, org: string, now: Date): Promise<TeamWarnings> {
  const thunder = org === "thunder";
  const { settings, setBy, uniformsKept } = await teamWarningSettings(q, org);
  const [teams, players, staff] = thunder
    ? ["teams t", "team_players p on p.team_id = t.id", "team_staff s on s.team_id = t.id"]
    : ["org_teams t", "org_team_players p on p.team_id = t.id", "org_team_coaches s on s.team_id = t.id"];
  const where = thunder ? "" : "where t.org = $1";

  const roster = settings.roster.on
    ? (
        await q.query<{ id: string; name: string; n: number }>(
          `select t.id::text, t.name, count(p.*)::int as n from ${teams} left join ${players} ${where}
           group by t.id, t.name having count(p.*) < $${thunder ? 1 : 2} order by 3, lower(t.name)`,
          thunder ? [settings.roster.min] : [org, settings.roster.min],
        )
      ).rows.map((t) => ({ id: t.id, name: t.name, detail: `${t.n} player${t.n === 1 ? "" : "s"}` }))
    : null;

  const idle = settings.idle.on
    ? (
        await q.query<{ id: string; name: string; last: Date | null }>(
          `select t.id::text, t.name, max(v.hour) as last
           from ${teams} left join ${staff} left join site_visits v on v.coach_id = s.coach_id and v.org = $1 ${where}
           group by t.id, t.name
           having max(v.hour) is null or max(v.hour) < $2::timestamptz - make_interval(days => $3::int)
           order by max(v.hour) asc nulls first, lower(t.name)`,
          [org, now, settings.idle.days],
        )
      ).rows.map((t) => ({
        id: t.id,
        name: t.name,
        detail: t.last ? `last ${Math.floor((now.getTime() - new Date(t.last).getTime()) / 86_400_000)} days ago` : "never",
      }))
    : null;

  const uniforms =
    settings.uniforms.on && uniformsKept
      ? (
          await q.query<{ id: string; name: string; n: number }>(
            `select t.id::text, t.name, count(*)::int as n from teams t
             join team_players p on p.team_id = t.id
             left join registrations g on g.registrant_id = p.registrant_id
             left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
             where u.number is null or ((coalesce(g.uniform_needed, false) or u.needs_uniform_at is not null) and u.size is null)
             group by t.id, t.name order by 3 desc, lower(t.name)`,
          )
        ).rows.map((t) => ({ id: t.id, name: t.name, detail: `${t.n} player${t.n === 1 ? "" : "s"} missing` }))
      : null;

  const ids = new Set([...(roster ?? []), ...(idle ?? []), ...(uniforms ?? [])].map((t) => t.id));
  return { settings, setBy, uniformsKept, roster, idle, uniforms, teams: ids.size };
}

// An organization's Admins (and Owners): which warnings are on, and their numbers.
export async function setTeamWarnings(deps: Deps, viewer: SessionUser, org: string, input: unknown): Promise<Result> {
  const settings = cleanWarnings(input);
  if (!settings)
    return {
      ok: false,
      message: `Players must be ${ROSTER_MIN[0]}–${ROSTER_MIN[1]} and days ${IDLE_DAYS[0]}–${IDLE_DAYS[1]}.`,
    };
  if (!(await isOrgAdmin(deps.pool, viewer.coachId, org)))
    return { ok: false, message: "Only an Admin of this organization can change its team warnings." };
  await deps.pool.query(
    "update organizations set team_warnings = $2, team_warnings_by = $3, team_warnings_at = $4 where slug = $1",
    [org, JSON.stringify(settings), `${viewer.firstName} ${viewer.lastName}`, deps.now()],
  );
  return { ok: true };
}
