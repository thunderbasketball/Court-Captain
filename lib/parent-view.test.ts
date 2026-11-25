import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { parentView } from "./parent-view";
import { createTestDb } from "./testing/db";

const person = (coachId: string, isDirector = false, areas?: SessionUser["thunderAreas"], more: object = {}) =>
  ({ coachId, firstName: "P", lastName: "X", isDirector, thunderAreas: areas, ...more }) as SessionUser;

describe("Parent view", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  it("coaches: that parent's players on their own team; Directors and Admins: all of them; nobody else; no login needed", async () => {
    const deps = { pool: db.pool, now: () => new Date("2026-11-25T15:00:00Z") };
    const reg = (id: string, first: string, p1: string | null, owed: number) =>
      db.pool.query(
        `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, parent1_first, parent1_last, parent1_cell, raw, imported_at, imported_by, amount_remaining)
         values ($1, $1, $2, 'Lee', 'Girls', '4', 4, 'x', 'Mom', 'Lee', $3, '{}', now(), 'x', $4)`,
        [id, first, p1, owed],
      );
    await reg("r1", "Ann", "4235550001", 90);
    await reg("r2", "Bea", "4235550001", 10); // her sister, on another team
    await reg("r3", "Cy", null, 0); // no cell
    const team = async (name: string, kid: string, coach: string, role: string) => {
      const id = (await db.pool.query<{ id: string }>("insert into teams (name, gender, grades, grade_sort, level, created_by) values ($1, 'Girls', '{4}', 4, 'REC', 'x') returning id::text", [name])).rows[0].id;
      await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ($1, 'C', $2, $3)", [coach, name, `423${coach}`]);
      await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, $2, $3, 'x')", [id, coach, role]);
      await db.pool.query(
        "insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at) values ($1, $2, 'K', 'Lee', 'Girls', '4', 4, 'x', now())",
        [id, kid],
      );
      return id;
    };
    const a = await team("4G A", "r1", "5550101", "HeadCoach");
    await team("4G B", "r2", "5550102", "AsstCoach");
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550103', 'Mg', 'X', '4235550103')");
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550103', 'Manager', 'x')", [a]);
    const seen = async (v: SessionUser, id = "r1", slot: unknown = 1) => {
      const x = await parentView(deps, v, id, slot);
      return x && { kids: x.players.map((p) => `${p.name} ${p.team?.name ?? "-"}`), owed: x.owed, whole: x.whole, login: x.login };
    };
    expect(await seen(person("5550101"))).toEqual({ kids: ["Ann Lee 4G A"], owed: null, whole: false, login: null });
    expect(await seen(person("5550101"), "r2")).toBeNull(); // not on their team
    expect(await seen(person("5550102"), "r2")).toMatchObject({ kids: ["Bea Lee 4G B"] });
    expect(await seen(person("5550103"))).toBeNull(); // a Team Manager
    expect(await seen(person("5550199"))).toBeNull();
    expect(await seen(person("5550104", true, ["uniforms"]))).toBeNull();
    const both = ["Ann Lee 4G A", "Bea Lee 4G B"];
    expect(await seen(person("5550104", true, ["teams"]))).toEqual({ kids: both, owed: null, whole: true, login: null });
    expect(await seen(person("5550104", true, ["players"]))).toEqual({ kids: both, owed: 100, whole: true, login: null });
    const admin = person("9913694", true, undefined, { isAdmin: true });
    expect(await seen(admin)).toEqual({ kids: both, owed: 100, whole: true, login: { coachId: null, verified: false } });
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell, email, verified_email) values ('5550001', 'Mom', 'Lee', '4235550001', 'm@x.com', 'M@x.com')");
    expect(await seen(admin)).toMatchObject({ login: { coachId: "5550001", verified: true } });
    expect(await seen({ ...admin, actingBy: "x" } as unknown as SessionUser)).toMatchObject({ login: null }); // viewing as someone already
    // No cell on the registration: just that player. No second parent, or a bad request: nothing.
    expect(await seen(admin, "r3")).toMatchObject({ kids: ["Cy Lee -"], login: null });
    expect(await seen(admin, "r1", 2)).toBeNull();
    for (const [id, slot] of [["zz", 1], ["r1'; drop", 1], ["r1", 3], ["r1", "1"]] as const) expect(await seen(admin, id, slot)).toBeNull();
  }, 60_000);
});
