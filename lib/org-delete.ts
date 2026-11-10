// Deleting an organization (SPEC.md section 14): CourtCaptain Admins only, typing its name to confirm. It removes the
// organization and everything that is its own: its teams (with coaches and rosters), their copies in Scenic City's
// Leagues and those registrations, its imports, roles, features, gyms, partner listing and partnerships. People's logins
// stay. Thunder and Scenic City can't be deleted. Refused while any of its teams has League games, or a game is set at
// one of its gyms, so a schedule is never quietly broken (take them out of the schedule first).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { BUILT_IN, isOrgSlug } from "./orgs";
import { isPlatformAdmin } from "./platform";
import { dropScenicCoachIfIdle } from "./scenic-teams";
import { withTx } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true; teams: number } | { ok: false; message: string };

export async function deleteOrganization(deps: Deps, viewer: SessionUser, org: unknown, typedName: unknown): Promise<Result> {
  if (!(await isPlatformAdmin(deps.pool, viewer.coachId))) return { ok: false, message: "Only a CourtCaptain Admin can do that." };
  if (!isOrgSlug(org)) return { ok: false, message: "That organization no longer exists." };
  if ((BUILT_IN as readonly string[]).includes(org)) return { ok: false, message: "Thunder and Scenic City can't be deleted." };
  return withTx(deps.pool, async (q) => {
    const o = await q.query<{ name: string }>("select name from organizations where slug = $1 for update", [org]);
    if (!o.rowCount) return { ok: false as const, message: "That organization no longer exists." };
    const name = o.rows[0].name;
    const typed = typeof typedName === "string" ? typedName.trim().toLowerCase() : "";
    if (typed !== name.trim().toLowerCase()) return { ok: false as const, message: `Type ${name} exactly to delete it.` };

    // Its teams in Scenic City: copies of its own teams, and teams listed under its partner record (a CourtSolo team).
    const copies = (
      await q.query<{ id: string }>(
        `select t.id::text from scenic_teams t
          where t.org_team_id in (select id from org_teams where org = $1)
             or t.partner_id in (select id from partners where org_slug = $1)`,
        [org],
      )
    ).rows.map((r) => r.id);
    const games = await q.query<{ n: number }>(
      "select count(*)::int as n from scenic_matchups where team_a = any($1::bigint[]) or team_b = any($1::bigint[])",
      [copies],
    );
    if (games.rows[0].n > 0)
      return {
        ok: false as const,
        message: `${name}'s teams have ${games.rows[0].n} League game${games.rows[0].n === 1 ? "" : "s"}. Take them out of the schedule first.`,
      };
    // Games set at its gyms (a partner's court "123", or an organization's gym court "o39-12" / whole gym "o39-gym").
    const atGyms = await q.query<{ n: number }>(
      `select count(*)::int as n from scenic_matchups m
        where (m.court_key ~ '^[0-9]+$' and m.court_key::bigint in (
                 select c.id from partner_courts c join partner_gyms g on g.id = c.gym_id
                  join partners p on p.id = g.partner_id where p.org_slug = $1))
           or (m.court_key like 'o%' and split_part(substr(m.court_key, 2), '-', 1) in (select id::text from gyms where org = $1))`,
      [org],
    );
    if (atGyms.rows[0].n > 0)
      return {
        ok: false as const,
        message: `${atGyms.rows[0].n} League game${atGyms.rows[0].n === 1 ? " is" : "s are"} set at ${name}'s gyms. Move them first.`,
      };

    const teams = (await q.query<{ n: number }>("select count(*)::int as n from org_teams where org = $1", [org])).rows[0].n;
    const coaches = (
      await q.query<{ coach_id: string }>(
        "select distinct coach_id from scenic_teams where id = any($1::bigint[]) and coach_id is not null",
        [copies],
      )
    ).rows.map((r) => r.coach_id);
    // Its league teams (and their registrations), then its own teams (their coaches, rosters and copies go with them).
    await q.query("delete from scenic_teams where id = any($1::bigint[])", [copies]);
    await q.query("delete from org_teams where org = $1", [org]);
    await q.query("delete from scenic_register_batches where org = $1", [org]);
    // What doesn't go on its own when the organization does.
    await q.query("delete from access_requests where org = $1", [org]);
    await q.query("delete from org_partnerships where host_org = $1 or for_org = $1", [org]);
    await q.query("delete from org_roles where org = $1", [org]);
    await q.query("delete from org_role_types where org = $1", [org]);
    await q.query("delete from partners where org_slug = $1", [org]);
    // Then the organization (its features, Director areas, gyms, imports, old links and the rest go with it).
    await q.query("delete from organizations where slug = $1", [org]);
    const who = `${viewer.firstName} ${viewer.lastName}`;
    for (const c of coaches) await dropScenicCoachIfIdle(q, c, who); // no Scenic City team left: not a Coach there
    return { ok: true as const, teams };
  });
}
