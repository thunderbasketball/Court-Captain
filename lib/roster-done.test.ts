import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rostersDone } from "./roster-done";
import { createTestDb } from "./testing/db";

const NOW = new Date("2026-11-27T15:00:00Z");

describe("rosters complete", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query<{ id: string }>(sql, p)).rows;

  it("complete: players, each with a birthdate that can be right and a number, no number twice; by grade, or by organization in the League", async () => {
    await q("insert into organizations (slug, name, short_name, kind) values ('club', 'Club', 'CL', 'Organization')");
    expect(await rostersDone(db.pool, "club", NOW)).toBeNull(); // no teams
    const team = async (name: string, grade: number, archived = false) =>
      (await q(`insert into org_teams (org, name, gender, grade_low, grade, level, created_by${archived ? ", archived_at" : ""}) values ('club', $1, 'Boys', $2, $2, 'REC', 't'${archived ? ", now()" : ""}) returning id::text`, [name, grade]))[0].id;
    const [done, , noDate, oddDate, noNumber, twice] = [await team("5B A", 5), await team("5B B", 5), // 5B B: no players
      await team("5B C", 5), await team("4B D", 4), await team("4B E", 4), await team("4B F", 4)];
    await team("4B Old", 4, true); // archived: not counted
    const player = (t: string, first: string, jersey: string | null, birthdate: string | null, grade = 5) =>
      q("insert into org_team_players (team_id, first_name, last_name, grade, jersey, birthdate, added_by) values ($1, $2, 'X', $3, $4, $5, 't')", [t, first, grade, jersey, birthdate]);
    await player(done, "A", "1", "2016-03-01");
    await player(done, "B", "2", "2016-05-01");
    await player(noDate, "A", "1", null);
    await player(oddDate, "A", "1", "2024-01-01", 4); // a 2-year-old can't be in 4th grade
    await player(noNumber, "A", null, "2017-03-01", 4);
    await player(twice, "A", "3", "2017-03-01", 4);
    await player(twice, "B", "03", "2017-04-01", 4);
    expect(await rostersDone(db.pool, "club", NOW)).toEqual({
      using: 1,
      total: 6,
      percent: 17,
      by: "grade",
      parts: [
        { name: "4th Boys", using: 0, total: 3, percent: 0 },
        { name: "5th Boys", using: 1, total: 3, percent: 33 },
      ],
    });
    // Without numbers counting (Thunder with Uniforms off): only the missing number stops being a warning.
    expect((await rostersDone(db.pool, "club", NOW, false))!.using).toBe(2);

    // The League: its registered teams, from wherever the roster is kept (here: typed in), by organization; removed ones don't count.
    await q("insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Al', 'X', '4235550001')");
    const prog = (await q("insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by) values ('League', 'W', '2026-12-05', '2027-02-28', '2026-10-01', '2027-01-31', 't', 't') returning id::text"))[0].id;
    const div = (await q("insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Boys', 5, 5) returning id::text", [prog]))[0].id;
    const g = (await q("insert into scenic_grade_groups (division_id, grade, level) values ($1, 5, 'REC') returning id::text", [div]))[0].id;
    const pool = (await q("insert into scenic_pools (group_id, name) values ($1, 'A') returning id::text", [g]))[0].id;
    const st = async (name: string, removed = false) => {
      const id = (await q("insert into scenic_teams (name, gender, grade_low, grade, level, coach_id, owner_coach_id, created_by, updated_by) values ($1, 'Boys', 5, 5, 'REC', '5550001', '5550001', 't', 't') returning id::text", [name]))[0].id;
      await q("insert into scenic_registrations (program_id, team_id, pool_id, registered_by, removed_by) values ($1, $2, $3, 't', $4)", [prog, id, pool, removed ? "t" : null]);
      return id;
    };
    const [l1] = [await st("5B One"), await st("5B Two"), await st("5B Gone", true)];
    await q("insert into scenic_team_players (team_id, first_name, last_name, grade, jersey, birthdate, added_by) values ($1, 'A', 'X', 5, '4', '2016-03-01', 't')", [l1]);
    expect(await rostersDone(db.pool, "scenic-city", NOW)).toEqual({
      using: 1,
      total: 2,
      percent: 50,
      by: "organization",
      parts: [{ name: "Solo teams", using: 1, total: 2, percent: 50 }],
    });
    expect(await rostersDone(db.pool, "scenic-city", new Date("2027-04-01T15:00:00Z"))).toBeNull(); // over
  });
});
