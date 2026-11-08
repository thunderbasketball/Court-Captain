// Adds outside clubs' teams registered in FastBreak Compete to Scenic City's current League (rules in lib/fastbreak/sync.ts).
//   npm run fastbreak -- --dry-run           (show what would happen; nothing changes)
//   npm run fastbreak -- --preview <id>,<id>,... (dry run: those events, e.g. last winter's weeks, stand for this League's
//     Game Days in order)
//     add --new-clubs to treat organizations still to pick as new outside clubs
//   npm run fastbreak
import pg from "pg";
import { fastbreakClient } from "../lib/fastbreak/client";
import { summary, syncFastbreak } from "../lib/fastbreak/sync";

const at = process.argv.indexOf("--preview");
const previewEvents = at > 0 ? (process.argv[at + 1] ?? "").split(",").map(Number) : undefined;
if (previewEvents && !previewEvents.every((n) => Number.isInteger(n) && n > 0)) {
  console.log("--preview needs Fastbreak event IDs, separated by commas.");
  process.exit(1);
}
const asNewClubs = process.argv.includes("--new-clubs");
const dryRun = process.argv.includes("--dry-run") || !!previewEvents || asNewClubs;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2 });
try {
  const r = await syncFastbreak(
    { pool, now: () => new Date(), client: fastbreakClient() },
    { dryRun, previewEvents, asNewClubs },
  );
  if (r.status !== "done") {
    console.log(r.status === "busy" ? "Another Fastbreak sync is running. Try again in a minute." : r.message);
    process.exitCode = 1;
  } else {
    const { report } = r;
    const list = (title: string, items: string[]) => {
      console.log(`\n${title} (${items.length})`);
      for (const x of items) console.log(`  ${x}`);
    };
    list("Fastbreak events used", report.events);
    list("Teams added", report.added);
    list("Registered", report.registered);
    list(
      "Waiting: pick what these Fastbreak organizations are",
      report.waiting.map((o) => `${o.org} (${o.teams} team${o.teams === 1 ? "" : "s"})`),
    );
    list(
      "On CourtCaptain (skipped: they register their own)",
      report.onCourtCaptain.map((o) => `${o.org} (${o.teams})`),
    );
    list("Problems", report.problems);
    console.log(`\n${summary(report)}${dryRun ? "\nDry run: nothing was changed." : ""}`);
  }
} finally {
  await pool.end();
}
