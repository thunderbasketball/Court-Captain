import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanWarnings, DEFAULT_WARNINGS, orgTeamWarnings, setTeamWarnings } from "./team-warnings";
import { createTestDb } from "./testing/db";

// Tuesday Nov 3, 2026, 10 AM Eastern.
const NOW = new Date("2026-11-03T15:00:00Z");
const al = { coachId: "5550001", firstName: "Al", lastName: "X" } as never;
const di = { coachId: "5550002", firstName: "Di", lastName: "X" } as never;

describe("team warnings", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => NOW });
  let busy = "";


  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Al', 'X', '4235550001'),
         ('5550002', 'Di', 'X', '4235550002'), ('5550003', 'Cy', 'Coach', '4235550003')`,
    );
    await db.pool.query("select set_role('5550001', 'thunder', 'Admin', true, 'test'), set_role('5550002', 'thunder', 'Director', true, 'test')");
    const team = async (name: string) =>
      (
        await db.pool.query<{ id: string }>(
          "insert into teams (name, gender, grades, grade_sort, level, created_by) values ($1, 'Boys', '{5}', 5, 'COMP', 'x') returning id::text",
          [name],
        )
      ).rows[0].id;
    busy = await team("5B Coach");
    await team("5B TBD");
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550003', 'HeadCoach', 'x')", [busy]);
    await db.pool.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       values ($1, 'r1', 'P', 'r1', 'Boys', '5', 5, 'x', now()), ($1, 'r2', 'P', 'r2', 'Boys', '5', 5, 'x', now())`,
      [busy],
    );
    await db.pool.query(
      "insert into team_uniforms (team_id, registrant_id, number, size, updated_by, updated_at) values ($1, 'r1', '12', null, 'x', now())",
      [busy],
    ); // r2 has no number
    await db.pool.query("insert into site_visits (org, hour, coach_id, views) values ('thunder', '2026-10-30T12:00:00Z', '5550003', 2)");
  });

  it("checks what's entered", () => {
    expect(cleanWarnings(DEFAULT_WARNINGS)).toEqual(DEFAULT_WARNINGS);
    expect(cleanWarnings({ ...DEFAULT_WARNINGS, roster: { on: true, min: 0 } })).toBeNull();
    expect(cleanWarnings({ ...DEFAULT_WARNINGS, idle: { on: true, days: "7" } })).toBeNull();
    expect(cleanWarnings({ ...DEFAULT_WARNINGS, uniforms: {} })).toMatchObject({ uniforms: { on: false } });
  });

  it("defaults: all on, fewer than 8 players, 14 days; each warning lists the teams it catches", async () => {
    const w = await orgTeamWarnings(db.pool, "thunder", NOW);
    expect(w.settings).toEqual(DEFAULT_WARNINGS);
    expect(w.roster!.map((t) => [t.name, t.detail])).toEqual([
      ["5B TBD", "0 players"],
      ["5B Coach", "2 players"],
    ]);
    expect(w.idle!.map((t) => [t.name, t.detail])).toEqual([["5B TBD", "never"]]); // 5B Coach's coach was on 4 days ago
    expect(w.uniforms!.map((t) => [t.name, t.detail])).toEqual([["5B Coach", "1 player missing"]]);
    expect(w.teams).toBe(2);
  });

  it("only Admins change them; turned-off warnings aren't checked and numbers change who's caught", async () => {
    const s = { roster: { on: true, min: 2 }, idle: { on: true, days: 3 }, uniforms: { on: false } };
    expect(await setTeamWarnings(deps(), di, "thunder", s)).toMatchObject({ ok: false });
    expect(await setTeamWarnings(deps(), al, "thunder", { ...s, idle: { on: true, days: 0 } })).toMatchObject({ ok: false });
    expect(await setTeamWarnings(deps(), al, "thunder", s)).toEqual({ ok: true });
    const w = await orgTeamWarnings(db.pool, "thunder", NOW);
    expect(w.setBy).toBe("Al X");
    expect(w.roster!.map((t) => t.name)).toEqual(["5B TBD"]);
    expect(w.idle!.map((t) => [t.name, t.detail])).toEqual([
      ["5B TBD", "never"],
      ["5B Coach", "last 4 days ago"],
    ]);
    expect(w.uniforms).toBeNull();
  });
});
