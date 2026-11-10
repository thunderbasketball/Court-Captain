import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testing/db";
import { cleanRules, orgGradeRules, setOrgGradeRules, setProgramGradeRules } from "./grade-rules";
import { DEFAULT_RULES } from "./eligibility";

describe("grade requirements", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  const now = new Date("2026-11-10T12:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const earl = { coachId: "5550001", firstName: "Earl", lastName: "X" } as never;
  const sep1 = { month: 9, day: 1, oldest: 8, exception: null };

  beforeEach(async () => {
    await db.reset();
  });

  it("checks what's entered", () => {
    expect(cleanRules(DEFAULT_RULES)).toEqual(DEFAULT_RULES);
    expect(cleanRules({ ...DEFAULT_RULES, month: 2, day: 30 })).toBeNull();
    expect(cleanRules({ ...DEFAULT_RULES, exception: 8 })).toBeNull(); // the exception must be younger than the oldest
    expect(cleanRules({ ...DEFAULT_RULES, oldest: "8" })).toBeNull();
  });

  it("Admins set their own; adopting uses the current League's, and only Directors of Programs set a League's", async () => {
    const pre = await db.pool.query<{ ok: boolean }>("select acts_as('5550001', 'thunder', 'Admin') as ok");
    expect(pre.rows[0].ok).toBe(false);
    expect(await setOrgGradeRules(deps(), earl, "thunder", { adopt: false, rules: sep1 })).toMatchObject({ ok: false });
    expect(await setProgramGradeRules(deps(), earl, "1", sep1)).toMatchObject({ ok: false });
    expect((await orgGradeRules(db.pool, "thunder", now)).rules).toEqual(DEFAULT_RULES);

    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Earl', 'X', '4235550001')");
    await db.pool.query("insert into org_roles (coach_id, org, role, granted_by) values ('5550001', 'thunder', 'Admin', 'x')");
    expect(await setOrgGradeRules(deps(), earl, "thunder", { adopt: true, rules: { ...sep1, day: 31 } })).toMatchObject({ ok: false });
    expect(await setOrgGradeRules(deps(), earl, "thunder", { adopt: true, rules: sep1 })).toEqual({ ok: true });
    // Adopting with no current League: its own.
    expect((await orgGradeRules(db.pool, "thunder", now)).rules).toEqual(sep1);
    await db.pool.query(
      `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by, grade_rules)
       values ('League', 'Old', '2025-12-01', '2026-02-28', '2025-10-01', '2025-11-01', 'x', 'x', $1),
              ('League', 'Winter', '2026-12-01', '2027-02-28', '2026-10-01', '2026-11-20', 'x', 'x', $2)`,
      [JSON.stringify(sep1), JSON.stringify({ ...DEFAULT_RULES, oldest: 9 })],
    );
    const r = await orgGradeRules(db.pool, "thunder", now);
    expect(r).toMatchObject({ adopt: true, from: "Winter", rules: { oldest: 9 }, own: sep1 });
  });
});
