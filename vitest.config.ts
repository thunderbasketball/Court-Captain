import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".next-check/**", "mobile/**"],
    env: loadEnv("test", process.cwd(), ""),
    // Database tests talk to Supabase over the internet.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Each test file opens its own database connections; Supabase caps the total, so only a few files run at once.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
