import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { teamRegistrations } from "./registrations-list";
import { createTestDb, grant } from "./testing/db";

describe("Registrations: each team's account", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const one = async (sql: string, p: unknown[] = []) => (await db.pool.query<{ id: string }>(sql, p)).rows[0]?.id;
  const owner = { coachId: "5550001", firstName: "Ow", lastName: "N", isDirector: true } as unknown as SessionUser;

  it("each transaction its own line (newest first, with its fee and who); the list by latest activity", async () => {
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Ow', 'N', '4235550001')");
    await grant(db.pool, "5550001 scenic-city Owner");
    const prog = await one(
      "insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by) values ('League', 'W', '2026-12-05', '2027-02-28', '2026-10-01', '2027-01-31', 't', 't') returning id::text",
    );
    await db.pool.query("insert into scenic_program_options (program_id, kind, fee_cents) values ($1, 'all_season', 25000), ($1, 'single_2nd', 3500), ($1, 'single_1', 4000)", [prog]);
    await db.pool.query("insert into game_days (day, created_by) values ('2026-12-05', 't'), ('2026-12-12', 't') on conflict do nothing");
    await db.pool.query("insert into program_game_days (program_id, game_day_id, added_by, kind) select $1, id, 't', 'game' from game_days", [prog]);
    const div = await one("insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Boys', 3, 3) returning id::text", [prog]);
    const g = await one("insert into scenic_grade_groups (division_id, grade, level) values ($1, 3, 'COMP') returning id::text", [div]);
    const pool = await one("insert into scenic_pools (group_id, name) values ($1, 'A') returning id::text", [g]);
    const team = async (name: string, at: string, allSeason: boolean) => {
      const id = await one(
        "insert into scenic_teams (name, gender, grade_low, grade, level, coach_id, owner_coach_id, created_by, updated_by) values ($1, 'Boys', 3, 3, 'COMP', '5550001', '5550001', 't', 't') returning id::text",
        [name],
      );
      await db.pool.query(
        "insert into scenic_registrations (program_id, team_id, pool_id, registered_by, registered_at, all_season) values ($1, $2, $3, 'Earl', $4, $5)",
        [prog, id, pool, at, allSeason],
      );
      return id!;
    };
    const north = await team("North", "2026-11-23T05:00:00Z", true);
    await team("Lions", "2026-11-25T12:00:00Z", false);
    await db.pool.query(
      `insert into scenic_registration_days (program_id, team_id, game_day_id, kind, registered_by, registered_at)
       select $1, $2, id, 'single_2nd', 'Scott', '2026-11-27T15:00:00Z' from game_days where day = '2026-12-05'`,
      [prog, north],
    );
    await db.pool.query("update scenic_registrations set paid = true, paid_set_by = 'Earl', paid_set_at = '2026-11-23T16:00:00Z' where team_id = $1", [north]);

    const rows = (await teamRegistrations({ pool: db.pool, now: () => new Date("2026-11-28T15:00:00Z") }, owner))!.rows;
    expect(rows.map((r) => r.team)).toEqual(["North", "Lions"]); // North's 2nd Game (Nov 27) is the latest activity
    expect(rows[0].lastAt).toBe("2026-11-27T15:00:00.000Z");
    expect(rows[0].feeCents).toBe(28500);
    expect(rows[0].activity).toEqual([
      { at: "2026-11-27T15:00:00.000Z", by: "Scott", what: "Dec 5: Add a 2nd Game (now 2GG)", cents: 3500 },
      { at: "2026-11-23T16:00:00.000Z", by: "Earl", what: "Marked Paid", cents: null },
      { at: "2026-11-23T05:00:00.000Z", by: "Earl", what: "Registered: ALL Season (1GG each Game Day)", cents: 25000 },
    ]);
  });
});
