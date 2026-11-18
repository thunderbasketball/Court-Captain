// An organization's Owners and Admins edit anyone on a team's staff (Head Coach, Assistant Coach, Team Manager, Team
// Parent; Thunder and every organization): first and last name, cell and email.
// - Same cell: that person's name and email are changed (a blank email clears it).
// - A different cell is a different person: the one with that cell is found (their name, and email when given, are
//   updated) or their login is made (starter PIN 1234), and they take this spot on the staff. A coach gets the Coach role.
// A new email is confirmed with a code at their next login. A Head Coach's team (and every team they head) is renamed to
// match their last name.
// Their role can change too (`newRole`): Head Coach ↔ Assistant Coach, Team Manager or Team Parent. A Head Coach moved
// to another role leaves the team TBD (renamed so) until a new Head Coach is set; someone becomes Head Coach only while
// the team has none (change the current one's role first). Thunder keeps one person per role. A coach role gives the
// organization's Coach role; leaving the coach roles takes it away when they coach none of the organization's teams.
import type { Pool, PoolClient } from "pg";
import type { SessionUser } from "./auth/service";
import { cleanEmail, cleanName } from "./auth/validate";
import { isOrgAdmin, isThunderAdmin } from "./org-admin";
import { isOrgSlug } from "./orgs";
import { normalizeCell } from "./phone";
import { withTx } from "./sql";
import { rename } from "./teams";
import { renameOrgTeam } from "./org-teams";
import { matchOrCreateUser } from "./user-match";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true; newLogin: boolean } | { ok: false; message: string };
class EditError extends Error {}

const ROLES = ["HeadCoach", "AsstCoach", "Manager", "TeamParent"];
const COACHES = ["HeadCoach", "AsstCoach"];
const LABEL: Record<string, string> = { HeadCoach: "Head Coach", AsstCoach: "Assistant Coach", Manager: "Team Manager", TeamParent: "Team Parent" };

export type StaffEditInput = {
  coachId: unknown;
  role: unknown;
  first: unknown;
  last: unknown;
  cell: unknown;
  email: unknown;
  newRole?: unknown; // their role from now on (not sent: the same)
};

export async function editTeamStaff(deps: Deps, viewer: SessionUser, org: unknown, teamId: unknown, input: StaffEditInput): Promise<Result> {
  if (!isOrgSlug(org)) return { ok: false, message: "That organization doesn't exist." };
  if (typeof teamId !== "string" || !/^\d{1,18}$/.test(teamId)) return { ok: false, message: "That team no longer exists." };
  const admin = (org === "thunder" && isThunderAdmin(viewer)) || (await isOrgAdmin(deps.pool, viewer.coachId, org));
  if (!admin) return { ok: false, message: "Only an Owner or Admin can change the team's staff." };
  const role = typeof input.role === "string" && ROLES.includes(input.role) ? input.role : null;
  if (!role || typeof input.coachId !== "string" || !/^\d{7}$/.test(input.coachId))
    return { ok: false, message: "That person isn't on this team's staff." };
  const oldId = input.coachId;
  const finalRole = input.newRole === undefined || input.newRole === null ? role : ROLES.includes(String(input.newRole)) ? String(input.newRole) : null;
  if (!finalRole) return { ok: false, message: "Pick Head Coach, Assistant Coach, Team Manager or Team Parent." };
  const first = cleanName(input.first);
  const last = cleanName(input.last);
  if (!first || !last) return { ok: false, message: "Enter a first and last name (letters only)." };
  const cell = typeof input.cell === "string" ? normalizeCell(input.cell) : null;
  if (!cell) return { ok: false, message: "Enter their 10-digit cell number." };
  const emailText = typeof input.email === "string" ? input.email.trim() : "";
  const email = emailText ? cleanEmail(emailText) : null;
  if (emailText && !email) return { ok: false, message: "That email doesn't look right." };
  const who = `${viewer.firstName} ${viewer.lastName}`;
  const now = deps.now();
  const thunder = org === "thunder";
  const staff = thunder ? "team_staff" : "org_team_coaches";
  try {
    const newLogin = await withTx(deps.pool, async (q) => {
      const t = await q.query(thunder ? "select 1 from teams where id = $1 for update" : "select 1 from org_teams where id = $1 and org = $2 for update", thunder ? [teamId] : [teamId, org]);
      if (!t.rowCount) throw new EditError("That team no longer exists.");
      const row = await q.query(`select 1 from ${staff} where team_id = $1 and coach_id = $2 and role = $3`, [teamId, oldId, role]);
      if (!row.rowCount) throw new EditError("That person isn't on this team's staff any more.");
      const cur = await q.query<{ cell: string | null }>("select cell from users where coach_id = $1 for update", [oldId]);
      let personId = oldId;
      let made = false;
      if (cur.rows[0]?.cell === cell) {
        // The same person: their name and email.
        await q.query("update users set first_name = $2, last_name = $3, email = $4, updated_at = $5, updated_by = $6 where coach_id = $1", [
          oldId,
          first,
          last,
          email,
          now,
          who,
        ]);
      } else {
        // A different person: found by their cell (updated) or made, then put in this spot.
        const m = await matchOrCreateUser(q, { first, last, cell, email }, now);
        if ("error" in m) throw new EditError(m.error);
        personId = m.coachId;
        made = m.newLogin;
        await q.query(
          `update users set first_name = $2, last_name = $3, email = coalesce($4, email), updated_at = $5, updated_by = $6
           where coach_id = $1`,
          [personId, first, last, email, now, who],
        );
        const there = await q.query<{ role: string }>(`select role from ${staff} where team_id = $1 and coach_id = $2`, [teamId, personId]);
        if (there.rows.some((r) => r.role === role || !thunder))
          throw new EditError(`${first} ${last} is already on this team's staff (${LABEL[there.rows[0].role] ?? there.rows[0].role}).`);
        await q.query(`update ${staff} set coach_id = $4, added_by = $5, added_at = $6 where team_id = $1 and coach_id = $2 and role = $3`, [
          teamId,
          oldId,
          role,
          personId,
          who,
          now,
        ]);
        if (!thunder && COACHES.includes(role)) await dropCoachIfIdle(q, org, oldId, who);
      }
      // A new role: Head Coach only while the team has none; Thunder keeps one person per role.
      if (finalRole !== role) {
        const held = await q.query<{ who: string }>(
          `select u.first_name || ' ' || u.last_name as who from ${staff} s join users u on u.coach_id = s.coach_id
            where s.team_id = $1 and s.role = $2 and s.coach_id <> $3 limit 1`,
          [teamId, finalRole, personId],
        );
        if (held.rows[0] && (thunder || finalRole === "HeadCoach"))
          throw new EditError(
            `This team already has a ${LABEL[finalRole]} (${held.rows[0].who}). ${finalRole === "HeadCoach" ? "Change their role first, then make" : "Remove or change them first, then make"} ${first} ${last} ${LABEL[finalRole]}.`,
          );
        if (thunder) {
          const mine = await q.query("select 1 from team_staff where team_id = $1 and coach_id = $2 and role = $3", [teamId, personId, finalRole]);
          if (mine.rowCount) throw new EditError(`${first} ${last} is already ${LABEL[finalRole]} on this team.`);
        }
        await q.query(`update ${staff} set role = $4, added_by = $5, added_at = $6 where team_id = $1 and coach_id = $2 and role = $3`, [
          teamId,
          personId,
          role,
          finalRole,
          who,
          now,
        ]);
        // A new Head Coach replaces a coach still waiting for a cell.
        if (finalRole === "HeadCoach")
          await q.query(`update ${thunder ? "teams" : "org_teams"} set coach_first = null, coach_last = null where id = $1`, [teamId]);
      }
      // The organization's Coach role follows the coach roles.
      if (COACHES.includes(finalRole) && (personId !== oldId || !COACHES.includes(role)))
        await q.query("select set_role($1, $2, 'Coach', true, $3), set_role($1, $2, 'Request', false, $3)", [personId, org, who]);
      if (!thunder && COACHES.includes(role) && !COACHES.includes(finalRole)) await dropCoachIfIdle(q, org, personId, who);
      // A league's copy of this team (Scenic City) follows its Head Coach, or none (Thunder's follows in rename()).
      if (!thunder && (role === "HeadCoach" || finalRole === "HeadCoach"))
        await q.query(
          "update scenic_teams set coach_id = (select coach_id from org_team_coaches where team_id = $1 and role = 'HeadCoach' limit 1) where org_team_id = $1",
          [teamId],
        );
      // Team names carry the Head Coach's last name (or TBD without one): this team, and every team the person heads.
      if (role === "HeadCoach" || finalRole === "HeadCoach")
        await (thunder ? rename(q, teamId, role === "HeadCoach" && finalRole !== "HeadCoach") : renameOrgTeam(q, org, teamId));
      await renameHeaded(q, personId);
      return made;
    });
    return { ok: true, newLogin };
  } catch (e) {
    if (e instanceof EditError) return { ok: false, message: e.message };
    throw e;
  }
}

async function renameHeaded(q: PoolClient, coachId: string) {
  const th = await q.query<{ id: string }>("select team_id::text as id from team_staff where coach_id = $1 and role = 'HeadCoach' order by 1", [coachId]);
  for (const t of th.rows) await rename(q, t.id);
  const ot = await q.query<{ id: string; org: string }>(
    `select t.id::text, t.org from org_team_coaches c join org_teams t on t.id = c.team_id
     where c.coach_id = $1 and c.role = 'HeadCoach' order by t.org, t.id`,
    [coachId],
  );
  for (const t of ot.rows) await renameOrgTeam(q, t.org, t.id);
}

// Someone no longer coaching any of the organization's teams loses its Coach role.
async function dropCoachIfIdle(q: PoolClient, org: string, coachId: string, who: string) {
  const still = await q.query(
    `select 1 from org_team_coaches c join org_teams t on t.id = c.team_id
     where t.org = $1 and c.coach_id = $2 and c.role in ('HeadCoach', 'AsstCoach') limit 1`,
    [org, coachId],
  );
  if (!still.rowCount) await q.query("select set_role($1, $2, 'Coach', false, $3)", [coachId, org, who]);
}
