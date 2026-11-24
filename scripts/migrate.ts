// Applies db/migrations/*.sql in order, once each.
// Usage: npm run db:migrate            (app schema)
//        DB_SCHEMA=app_test_x npm run db:migrate
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

export async function migrate(client: pg.ClientBase, schema: string): Promise<string[]> {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Bad schema name: ${schema}`);
  await client.query(`create schema if not exists ${schema}`);
  await client.query(`set search_path to ${schema}`);
  await client.query(
    `create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`,
  );
  const dir = path.join(import.meta.dirname, "..", "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set(
    (await client.query("select name from schema_migrations")).rows.map((r) => r.name as string),
  );
  const applied: string[] = [];
  // On the real database, never wait in line for a table someone has open: everyone else's reads of it would queue behind
  // this. It stops after 3 seconds instead, with that file's changes undone; run it again. (Tests have their own copy.)
  if (schema === "public") await client.query("set lock_timeout = '3s'");
  for (const file of files) {
    if (done.has(file)) continue;
    await client.query("begin");
    try {
      await client.query(readFileSync(path.join(dir, file), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      applied.push(file);
    } catch (e) {
      await client.query("rollback");
      throw new Error(`${file}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return applied;
}

if (import.meta.main) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const applied = await migrate(client, process.env.DB_SCHEMA ?? "public");
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Already up to date.");
  } finally {
    await client.end();
  }
}
