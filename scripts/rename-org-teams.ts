// Rename every registered organization's teams by the current rule (Nov 2026): "8B Testing Basketball Smith" (grade and
// gender, the organization's short name, the Head Coach's last name), and their League names (a REC team's with the
// organization's Abbreviation first). Teams with their own name keep it; Thunder (its own tables) and Scenic City aren't
// touched. Each organization in one transaction.
//   npx tsx --env-file=.env.local scripts/rename-org-teams.ts --dry-run   (counts only; nothing changes)
//   npx tsx --env-file=.env.local scripts/rename-org-teams.ts
import pg from "pg";
import { renameAllOrgTeams } from "../lib/org-teams";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const dryRun = process.argv.includes("--dry-run");
const orgs = await pool.query<{ slug: string }>(
  "select slug from organizations where slug not in ('thunder', 'scenic-city') and kind <> 'Team' and exists (select 1 from org_teams t where t.org = slug) order by slug",
);
let teams = 0;
let league = 0;
for (const [i, o] of orgs.rows.entries()) {
  const q = await pool.connect();
  try {
    await q.query("begin");
    const before = await q.query<{ n: string }>(
      "select st.id::text || ':' || st.name as n from scenic_teams st join org_teams t on t.id = st.org_team_id where t.org = $1",
      [o.slug],
    );
    const changed = await renameAllOrgTeams(q, o.slug);
    const after = await q.query<{ n: string }>(
      "select st.id::text || ':' || st.name as n from scenic_teams st join org_teams t on t.id = st.org_team_id where t.org = $1",
      [o.slug],
    );
    const was = new Set(before.rows.map((r) => r.n));
    const leagueChanged = after.rows.filter((r) => !was.has(r.n)).length;
    teams += changed;
    league += leagueChanged;
    console.log(`Organization ${i + 1} of ${orgs.rows.length}: ${changed} team name(s), ${leagueChanged} League name(s)`);
    await q.query(dryRun ? "rollback" : "commit");
  } catch (e) {
    await q.query("rollback");
    throw e;
  } finally {
    q.release();
  }
}
console.log(`${dryRun ? "Would rename" : "Renamed"} ${teams} team(s) and ${league} League name(s) in ${orgs.rows.length} organization(s).`);
await pool.end();
