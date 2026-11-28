// A team's own logo (SPEC.md section 13): set on its team page by its Head Coach or Team Manager, or by its organization's
// Owners, Admins and Directors of Teams (Scenic City's for a Solo League team, besides its own coach). Shown on its Game Day
// pictures in place of its organization's logo. PNG, JPEG or WebP up to 512 KB, checked by its first bytes.
// One store for every kind of team: "t:<id>" a Thunder team, "o:<id>" an organization's team, "s:<id>" a Solo League team.
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { orgHasArea } from "./org-admin";
import { logoType, type Logo } from "./org-signup";
import type { Queryable } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string };
export type TeamKind = "thunder" | "org" | "league";
export const LOGO_MAX = 512 * 1024;

const PREFIX: Record<TeamKind, string> = { thunder: "t", org: "o", league: "s" };
const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,18}$/.test(v);
export const teamKey = (kind: TeamKind, id: string) => `${PREFIX[kind]}:${id}`;

export { LEAGUE_TEAM_KEY_SQL } from "./team-logo-key";
// Its link (null: none); the ?v= changes when the logo does, so browsers can keep it.
export const TEAM_LOGO_URL_SQL = (key: string) =>
  `(select '/team-logo/' || replace(l.team_key, ':', '-') || '?v=' || extract(epoch from l.updated_at)::bigint from team_logos l where l.team_key = ${key})`;

// May this person set this team's logo? Read from the database every time (never the browser).
export async function canSetTeamLogo(q: Pick<Queryable, "query">, viewer: SessionUser, kind: TeamKind, id: string): Promise<boolean> {
  if (!isId(id)) return false;
  if (kind === "thunder") {
    const r = await q.query("select 1 from team_staff s join teams t on t.id = s.team_id where s.team_id = $1 and s.coach_id = $2 and s.role in ('HeadCoach', 'Manager')", [
      id,
      viewer.coachId,
    ]);
    if (r.rowCount) return true;
    const t = await q.query("select 1 from teams where id = $1", [id]);
    return !!t.rowCount && orgHasArea(q, viewer.coachId, "thunder", "teams");
  }
  if (kind === "org") {
    const t = await q.query<{ org: string; staff: boolean }>(
      `select ot.org, exists (select 1 from org_team_coaches c where c.team_id = ot.id and c.coach_id = $2 and c.role in ('HeadCoach', 'Manager')) as staff
         from org_teams ot where ot.id = $1`,
      [id, viewer.coachId],
    );
    const row = t.rows[0];
    return !!row && (row.staff || orgHasArea(q, viewer.coachId, row.org, "teams"));
  }
  const t = await q.query<{ mine: boolean }>(
    "select (coach_id = $2 or owner_coach_id = $2) as mine from scenic_teams where id = $1 and thunder_team_id is null and org_team_id is null",
    [id, viewer.coachId],
  );
  const row = t.rows[0];
  return !!row && (row.mine || orgHasArea(q, viewer.coachId, "scenic-city", "teams"));
}

// The team's logo link (null: none) and whether this person may change it, for its team page.
export async function teamLogo(q: Pick<Queryable, "query">, viewer: SessionUser, kind: TeamKind, id: string): Promise<{ logo: string | null; canSet: boolean }> {
  if (!isId(id)) return { logo: null, canSet: false };
  const [r, canSet] = await Promise.all([
    q.query<{ logo: string | null }>(`select ${TEAM_LOGO_URL_SQL("$1")} as logo`, [teamKey(kind, id)]),
    canSetTeamLogo(q, viewer, kind, id),
  ]);
  return { logo: r.rows[0]?.logo ?? null, canSet };
}

// Set or remove (null) a team's logo.
export async function setTeamLogo(deps: Deps, viewer: SessionUser, kind: unknown, id: unknown, logo: Logo): Promise<Result> {
  if ((kind !== "thunder" && kind !== "org" && kind !== "league") || !isId(id)) return { ok: false, message: "That team no longer exists." };
  if (logo) {
    if (logo.bytes.length > LOGO_MAX) return { ok: false, message: "The logo must be 512 KB or smaller." };
    if (!logoType(logo.bytes)) return { ok: false, message: "The logo must be a PNG, JPEG or WebP image." };
  }
  if (!(await canSetTeamLogo(deps.pool, viewer, kind, id)))
    return { ok: false, message: "Only the team's Head Coach or Team Manager, or the organization's Directors of Teams, can change its logo." };
  const key = teamKey(kind, id);
  if (!logo) {
    await deps.pool.query("delete from team_logos where team_key = $1", [key]);
    return { ok: true };
  }
  await deps.pool.query(
    `insert into team_logos (team_key, logo, logo_type, updated_by, updated_at) values ($1, $2, $3, $4, $5)
     on conflict (team_key) do update set logo = excluded.logo, logo_type = excluded.logo_type, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [key, Buffer.from(logo.bytes), logoType(logo.bytes), `${viewer.firstName} ${viewer.lastName}`, deps.now()],
  );
  return { ok: true };
}

// A League team's logo store: the team it comes from (Thunder's or an organization's), or its own for a Solo team.
export async function leagueTeamRef(q: Pick<Queryable, "query">, scenicId: string): Promise<{ kind: TeamKind; id: string } | null> {
  if (!isId(scenicId)) return null;
  const r = await q.query<{ t: string | null; o: string | null }>("select thunder_team_id::text as t, org_team_id::text as o from scenic_teams where id = $1", [scenicId]);
  const row = r.rows[0];
  if (!row) return null;
  return row.t ? { kind: "thunder", id: row.t } : row.o ? { kind: "org", id: row.o } : { kind: "league", id: scenicId };
}
