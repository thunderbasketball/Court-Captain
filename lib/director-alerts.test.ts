import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testing/db";
import { directorAlerts } from "./director-alerts";

describe("the Director's flashing tabs", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  beforeEach(async () => {
    await db.reset();
  });
  const now = new Date("2026-11-10T12:00:00Z");

  it("Teams while a team has an alert; Uniforms while a number or size is missing", async () => {
    expect(await directorAlerts(db.pool, now)).toEqual({ teams: false, uniforms: false });
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell, email) values ('5550001', 'Hank', 'X', '4235550001', 'h@x.com')",
    );
    const t = await db.pool.query<{ id: string }>(
      "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('3B X', 'Boys', '{3}', 3, 'REC', 'x') returning id::text",
    );
    const team = t.rows[0].id;
    expect(await directorAlerts(db.pool, now)).toEqual({ teams: true, uniforms: false }); // no Head Coach, no players
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x')", [team]);
    await db.pool.query(
      `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, birthdate, program, raw, imported_at, imported_by)
       values ('r1', 'r1', 'Ava', 'Z', 'Boys', '3', 3, $1, 'x', '{}', now(), 'x')`,
      ["2017-03-04"],
    );
    await db.pool.query(
      "insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at) values ($1, 'r1', 'Ava', 'Z', 'Boys', '3', 3, 'x', now())",
      [team],
    );
    expect(await directorAlerts(db.pool, now)).toEqual({ teams: false, uniforms: true }); // no number yet
    await db.pool.query("insert into team_uniforms (team_id, registrant_id, number, updated_by, updated_at) values ($1, 'r1', '7', 'x', now())", [team]);
    expect(await directorAlerts(db.pool, now)).toEqual({ teams: false, uniforms: false });
    await db.pool.query("update registrations set birthdate = '2015-01-01'"); // too old for 3rd
    expect((await directorAlerts(db.pool, now)).teams).toBe(true);
  });
});
