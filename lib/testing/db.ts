// Test-only: a throwaway schema with all migrations applied, dropped when the test file ends.
import pg from "pg";
import { randomBytes } from "node:crypto";
import { migrate } from "../../scripts/migrate";

export async function createTestDb() {
  const schema = `app_test_${randomBytes(4).toString("hex")}`;
  const config = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };

  const setup = new pg.Client(config);
  await setup.connect();
  await migrate(setup, schema);
  await setup.end();

  const pool = new pg.Pool({ ...config, options: `-c search_path=${schema}`, max: 3, idleTimeoutMillis: 1000 });

  return {
    pool,
    async reset() {
      const r = await pool.query<{ tablename: string }>(
        // Keep the migrations log and reference data the migrations seed (organizations, their roles and features).
        "select tablename from pg_tables where schemaname = $1 and tablename not in ('schema_migrations', 'organizations', 'org_role_types', 'org_features')",
        [schema],
      );
      if (r.rows.length) await pool.query(`truncate ${r.rows.map((t) => t.tablename).join(", ")} cascade`);
    },
    async drop() {
      await pool.query(`drop schema ${schema} cascade`);
      await pool.end();
    },
  };
}

// A clock the tests can move forward.
export function testClock(start = "2026-11-02T17:00:00Z") {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    advanceMinutes: (m: number) => {
      t += m * 60_000;
    },
  };
}

// Captures emails instead of sending them.
export function testMailer() {
  const sent: { to: string; subject: string; text: string }[] = [];
  return {
    sent,
    sendEmail: async (to: string, subject: string, text: string) => {
      sent.push({ to, subject, text });
    },
    lastCode(): string {
      const m = sent.at(-1)?.text.match(/\b(\d{6})\b/);
      if (!m) throw new Error("No code emailed");
      return m[1];
    },
  };
}

// Gives roles, each as "<coachId> <org> <role>", e.g. grant(pool, "9913694 thunder Director").
export async function grant(pool: { query: (text: string, params: unknown[]) => Promise<unknown> }, ...roles: string[]) {
  for (const r of roles) {
    const [coachId, org, role] = r.split(" ");
    await pool.query("insert into org_roles (coach_id, org, role, granted_by) values ($1, $2, $3, 'test')", [coachId, org, role]);
  }
}

// Thunder roles as columns, for checking a user row: `select ${THUNDER_ROLES} from users ...`.
export const THUNDER_ROLES = `has_role(coach_id, 'thunder', 'Request') as thunder_request,
  has_role(coach_id, 'thunder', 'Coach') as thunder_coach, has_role(coach_id, 'thunder', 'Director') as thunder_director`;
