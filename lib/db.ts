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
    // DB_POOL_MAX overrides (`npm run dev`: 10, so a Home page's many small reads wait less; a host and scripts: 5).
    // Supabase's Session pooler allows 15 at once in all (dev server, scripts and tests together).
    max: Number(process.env.DB_POOL_MAX) || (transactionPooler ? 3 : process.env.NODE_ENV === "development" ? 10 : 5),
    // Hand idle connections back quickly so other copies of the app can use them.
    idleTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.thunderPool = db;

// Slow spots: every query taking SLOW_QUERY_MS or longer (default 500 ms) is logged with its time and the start of its
// SQL (never the values, so no personal info), in the `npm run dev` terminal or the host's function logs. Together with
// the dev terminal's own "GET /path 200 in 1.2s" and "POST … ƒ action in 80ms" lines, it shows where the app sticks.
const slowMs = Number(process.env.SLOW_QUERY_MS ?? 500);

// DB_PROFILE=true (in .env.local, for `npm run dev`): after each burst of queries (pages loading), one summary line: how
// many queries, how long the burst took, and the ten most repeated (the start of their SQL only, never values).
const profile = process.env.DB_PROFILE === "true";
const burst = { n: 0, start: 0, ms: 0, by: new Map<string, number>(), timer: null as ReturnType<typeof setTimeout> | null };
function profiled(sql: string, ms: number, began: number) {
  if (!burst.n || began < burst.start) burst.start = began;
  burst.n++;
  burst.ms += ms;
  const key = sql.replace(/\s+/g, " ").trim().slice(0, 90);
  burst.by.set(key, (burst.by.get(key) ?? 0) + 1);
  if (burst.timer) clearTimeout(burst.timer);
  burst.timer = setTimeout(() => {
    const top = [...burst.by.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10);
    console.warn(
      `[db profile] ${burst.n} queries in ${((performance.now() - burst.start - 1500) / 1000).toFixed(1)} s ` +
        `(avg ${Math.round(burst.ms / burst.n)} ms each incl. waiting). Most repeated:\n` +
        top.map(([k, c]) => `   ${String(c).padStart(4)}× ${k}`).join("\n"),
    );
    burst.n = 0;
    burst.ms = 0;
    burst.by.clear();
  }, 1500);
}
const timed = db as Pool & { timed?: boolean };
if (!timed.timed && (slowMs > 0 || profile)) {
  timed.timed = true;
  const query = db.query.bind(db) as (...args: unknown[]) => unknown;
  (db as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
    const start = performance.now();
    // Queries already waiting for one of the pool's few connections: their wait shows apart from the query's own time.
    const queued = db.waitingCount + (db.idleCount === 0 && db.totalCount >= (db.options.max ?? 10) ? 1 : 0);
    const result = query(...args);
    if (result instanceof Promise) {
      const sql = typeof args[0] === "string" ? args[0] : ((args[0] as { text?: string })?.text ?? "");
      void result.then(
        () => {
          const ms = Math.round(performance.now() - start);
          if (profile) profiled(sql, ms, start);
          if (slowMs <= 0 || ms < slowMs || profile) return; // with the profile on, its summary replaces these lines
          const why = queued ? ` (waited behind ${queued} other ${queued === 1 ? "query" : "queries"} for a connection)` : "";
          console.warn(`[slow query] ${ms} ms${why}: ${sql.replace(/\s+/g, " ").trim().slice(0, 140)}`);
        },
        () => {},
      );
    }
    return result;
  };
}
