import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gameDetails } from "./game-details";
import { createTestDb } from "./testing/db";

describe("Game details (public)", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const one = async (sql: string, p: unknown[] = []) => (await db.pool.query<{ id: string }>(sql, p)).rows[0]?.id;

  it("each team's record with every result, PI, points per game, differential and streak; only published games", async () => {
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Al', 'X', '4235550001')");
    const prog = await one(
      "insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by) values ('League', 'W', '2026-12-05', '2027-02-28', '2026-10-01', '2027-01-31', 't', 't') returning id::text",
    );
    const div = await one("insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Boys', 5, 5) returning id::text", [prog]);
    const g = await one("insert into scenic_grade_groups (division_id, grade, level) values ($1, 5, 'COMP') returning id::text", [div]);
    const pool = await one("insert into scenic_pools (group_id, name) values ($1, 'A') returning id::text", [g]);
    const team = async (name: string) => {
      const id = await one(
        "insert into scenic_teams (name, gender, grade_low, grade, level, coach_id, owner_coach_id, created_by, updated_by) values ($1, 'Boys', 5, 5, 'COMP', '5550001', '5550001', 't', 't') returning id::text",
        [name],
      );
      await db.pool.query("insert into scenic_registrations (program_id, team_id, pool_id, registered_by) values ($1, $2, $3, 't')", [prog, id, pool]);
      return id!;
    };
    const [magic, hawks, lions] = [await team("Magic"), await team("Hawks"), await team("Lions")];
    const game = (day: string, a: string, b: string, sa: number | null, sb: number | null, forfeit: string | null = null, home = "a") =>
      one(
        `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, home_side, score_a, score_b, forfeit, created_by, scored_by, scored_at)
         values ($1, $2, $3, $4, $5, $6, $7::smallint, $8::smallint, $9::text, 't', $10, $11)
         returning id::text`,
        [prog, div, day, a, b, home, sa, sb, forfeit, sa === null && !forfeit ? null : "t", sa === null && !forfeit ? null : new Date()],
      );
    await game("2026-12-05", magic, hawks, 40, 30); // Magic W 40-30
    await game("2026-12-12", magic, lions, 20, 25); // Magic L 20-25
    await game("2026-12-12", hawks, lions, null, null, "b"); // Lions forfeit: Hawks W
    const next = (await game("2026-12-19", magic, hawks, null, null, null, "b"))!; // Hawks home
    await db.pool.query("insert into scenic_pi (program_id, team_id, pi, wins, losses, games, updated_at) values ($1, $2, 540, 1, 1, 2, now())", [prog, magic]);

    expect(await gameDetails(db.pool, next)).toBeNull(); // not published yet
    expect(await gameDetails(db.pool, "nope")).toBeNull();
    await db.pool.query("insert into scenic_published_schedules (program_id, day, level, published_by, published_at) values ($1, '2026-12-19', 'COMP', 't', now())", [prog]);
    const d = (await gameDetails(db.pool, next))!;
    expect(d.teams.map((t) => [t.name, t.side])).toEqual([
      ["Magic", "away"],
      ["Hawks", "home"],
    ]);
    expect(d.teams[0]).toEqual({
      id: magic,
      name: "Magic",
      side: "away",
      pi: 540,
      wins: 1,
      losses: 1,
      ppg: 30,
      diff: 2.5,
      streak: "L1",
      games: [
        { date: "2026-12-12", opponent: "Lions", result: "L", score: "20-25" },
        { date: "2026-12-05", opponent: "Hawks", result: "W", score: "40-30" },
      ],
    });
    // A forfeit counts as a win or loss, never as points.
    expect(d.teams[1]).toMatchObject({ pi: 500, wins: 1, losses: 1, ppg: 30, diff: -10, streak: "W1" });
    expect(d.teams[1].games[0]).toEqual({ date: "2026-12-12", opponent: "Lions", result: "W", score: "Forfeit" });
  });
});
