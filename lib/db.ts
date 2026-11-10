import "server-only";
import { Pool } from "pg";

// One shared connection pool per server process.
// Reused across hot reloads in development so we don't leak connections.
const globalForDb = globalThis as unknown as { thunderPool?: Pool };

// Supabase's Transaction pooler (port 6543) shares a few database connections among many clients, which hosts
// like Netlify need: they run several copies of the app at once and would use up the Session pooler's 15.
// It doesn't accept startup options, so there we rely on public being the default search path.
const transactionPooler = /:6543\//.test(process.env.DATABASE_URL ?? "");

export const db =
  globalForDb.thunderPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    // Tables are in public, locked with row level security (see db/migrations/003_lock_tables.sql).
    ...(transactionPooler ? {} : { options: "-c search_path=public" }),
    max: transactionPooler ? 3 : 5,
    // Hand idle connections back quickly so other copies of the app can use them.
    idleTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.thunderPool = db;

// Slow spots: every query taking SLOW_QUERY_MS or longer (default 500 ms) is logged with its time and the start of its
// SQL (never the values, so no personal info), in the `npm run dev` terminal or the host's function logs. Together with
// the dev terminal's own "GET /path 200 in 1.2s" and "POST … ƒ action in 80ms" lines, it shows where the app sticks.
const slowMs = Number(process.env.SLOW_QUERY_MS ?? 500);
const timed = db as Pool & { timed?: boolean };
if (!timed.timed && slowMs > 0) {
  timed.timed = true;
  const query = db.query.bind(db) as (...args: unknown[]) => unknown;
  (db as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    const start = performance.now();
    const result = query(...args);
    if (result instanceof Promise) {
      const sql = typeof args[0] === "string" ? args[0] : ((args[0] as { text?: string })?.text ?? "");
      void result.then(
        () => {
          const ms = Math.round(performance.now() - start);
          if (ms >= slowMs) console.warn(`[slow query] ${ms} ms: ${sql.replace(/\s+/g, " ").trim().slice(0, 140)}`);
        },
        () => {},
      );
    }
    return result;
  };
}
