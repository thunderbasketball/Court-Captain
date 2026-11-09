// Move Scenic City's Solo teams (owned by a Solo coach) into their own CourtSolo accounts (lib/court-solo.ts).
//   npx tsx --env-file=.env.local scripts/court-solo-move.ts --dry-run   (list them; nothing changes)
//   npx tsx --env-file=.env.local scripts/court-solo-move.ts
import pg from "pg";
import { makeSoloAccount } from "../lib/court-solo";
import { withTx } from "../lib/sql";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
const dryRun = process.argv.includes("--dry-run");
const teams = await pool.query<{ id: string; name: string }>(
  "select id::text, name from scenic_teams where owner_coach_id is not null and org_team_id is null order by lower(name)",
);
for (const t of teams.rows) {
  if (dryRun) console.log(`Would move ${t.name}`);
  else console.log(`${t.name} → /org/${await withTx(pool, (q) => makeSoloAccount(q, t.id, "CourtSolo move", new Date()))}`);
}
if (!teams.rows.length) console.log("No Solo teams to move.");
await pool.end();
