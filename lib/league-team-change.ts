// Once a team is registered in a League (not ended), only the League changes its gender, grade or level (SPEC.md section 13), from its
// Teams page: an outside club's, an organization's or Thunder's. The organization's own team follows, its name by its rule, and it
// moves to its new division, with the games that need correcting shown first (lib/scenic-replace).
import type { Pool } from "pg";
import type { SessionUser } from "./auth/service";
import { orgHasArea } from "./org-admin";
import { renameOrgTeam } from "./org-teams";
import { parseGrade } from "./scenic-teams";
import { AskFirst, placeAgain } from "./scenic-replace";
import { registeredLeague } from "./team-guards";
import { preKProblem } from "./team-names";
import { rename } from "./teams";
import { syncThunderCopy } from "./thunder-leagues";
import { withTx } from "./sql";

type Deps = { pool: Pool; now: () => Date };
type Result = { ok: true } | { ok: false; message: string; warn?: string[] };
class Refused extends Error {}

const LEAGUE = "scenic-city";

// `id`: the League's team (scenic_teams). `anyway`: they've seen its games to correct.
export async function leagueChangeTeam(deps: Deps, viewer: SessionUser, id: unknown, input: { gender: unknown; grade: unknown; level: unknown }, anyway: unknown): Promise<Result> {
  const no = { ok: false as const, message: "Only the League's Directors of Teams, Admins and Owners can change that." };
  if (viewer.actingBy || !(await orgHasArea(deps.pool, viewer.coachId, LEAGUE, "teams"))) return no;
  if (typeof id !== "string" || !/^\d{1,18}$/.test(id)) return { ok: false, message: "That team no longer exists." };
  const gender = input.gender === "Boys" || input.gender === "Girls" || input.gender === "Coed" ? input.gender : null;
  const g = parseGrade(input.grade);
  const level = input.level === "REC" || input.level === "COMP" ? input.level : null;
  if (!gender || !g || !level) return { ok: false, message: "Pick a gender, grade and level." };
  const name = (n: number) => (n === -1 ? "PK" : n === 0 ? "K" : String(n));
  const grades = [...new Set([name(g.low), name(g.grade)])];
  const preK = preKProblem(gender, grades, level);
  if (preK) return { ok: false, message: preK };
  const by = `${viewer.firstName} ${viewer.lastName}`;
  const now = deps.now();
  try {
    return await withTx(deps.pool, async (q) => {
      const t = (
        await q.query<{ org_team: string | null; org: string | null; thunder: string | null }>(
          "select st.org_team_id::text as org_team, o.org, st.thunder_team_id::text as thunder from scenic_teams st left join org_teams o on o.id = st.org_team_id where st.id = $1 for update of st",
          [id],
        )
      ).rows[0];
      if (!t) throw new Refused("That team no longer exists.");
      // Not registered: its organization changes it.
      if ((t.org_team || t.thunder) && !(await registeredLeague(q, [id], now))) throw new Refused("It isn't registered in a League now: its organization changes it.");
      if (t.thunder) {
        if (gender === "Coed" || g.low === -1) throw new Refused("Thunder's teams are Boys or Girls, K to 12th.");
        await q.query("update teams set gender = $2, grades = $3, grade_sort = $4, level = $5 where id = $1", [t.thunder, gender, grades, g.grade, level]);
        await rename(q, t.thunder);
        await syncThunderCopy(q, t.thunder);
      } else if (t.org_team) {
        await q.query("update org_teams set gender = $2, grade_low = $3, grade = $4, level = $5, updated_by = $6, updated_at = $7 where id = $1", [t.org_team, gender, g.low, g.grade, level, by, now]);
        await q.query("update scenic_teams set gender = $2, grade_low = $3, grade = $4, level = $5 where id = $1", [id, gender, g.low, g.grade, level]);
        await renameOrgTeam(q, t.org!, t.org_team);
      } else await q.query("update scenic_teams set gender = $2, grade_low = $3, grade = $4, level = $5, updated_by = $6, updated_at = $7 where id = $1", [id, gender, g.low, g.grade, level, by, now]);
      const placed = await placeAgain(q, id, true, anyway === true, by, now);
      if ("error" in placed) throw new Refused(placed.error);
      return { ok: true as const };
    });
  } catch (e) {
    if (e instanceof Refused) return { ok: false, message: e.message };
    if (e instanceof AskFirst) return { ok: false, message: e.message, warn: e.warn };
    if ((e as { code?: string }).code === "23505") return { ok: false, message: "There's already a team with that name." };
    throw e;
  }
}
