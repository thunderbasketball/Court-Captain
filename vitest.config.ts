import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

// Tests use their own database (TEST_DATABASE_URL in .env.local: a separate Supabase project), never the live one:
// each test file builds a full copy of the tables, which on 2026-11-23 slowed the live site to a crawl.
const env = loadEnv("test", process.cwd(), "");
if (env.TEST_DATABASE_URL) env.DATABASE_URL = env.TEST_DATABASE_URL;
else if (!process.env.ALLOW_LIVE_DB_TESTS) {
  console.warn(
    "\n⚠ No TEST_DATABASE_URL in .env.local: database tests are turned off so they can't slow the live site.\n" +
      "  Add the test project's connection string as TEST_DATABASE_URL (see CLAUDE.md).\n",
  );
  delete env.DATABASE_URL;
}

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".next-check/**", "mobile/**"],
    env,
    // Database tests talk to Supabase over the internet.
    testTimeout: 60_000,
    hookTimeout: 180_000, // building a copy of the tables takes about 30 s
    // Each test file opens its own database connections; Supabase caps the total, so only a few files run at once.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
