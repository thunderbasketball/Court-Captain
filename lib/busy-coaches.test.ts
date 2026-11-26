import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busyCoaches } from "./busy-coaches";
import { createTestDb } from "./testing/db";

const NOW = new Date("2026-11-26T15:00:00Z");

describe("coaches on more than 2 teams", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query<{ id: string }>(sql, p)).rows;

  it("each organization's Head and Assistant Coaches with 3 or more of its teams, with their teams", async () => {
    await q("insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Al', 'X', '4235550001'), ('5550002', 'Bo', 'Y', '4235550002')");
    // An organization: Al heads 2 and assists a 3rd; Bo has 2; an archived team doesn't count; a Manager isn't a coach.
    await q("insert into organizations (slug, name, short_name, kind) values ('club', 'Club', 'CL', 'Organization')");
    const team = async (name: string, archived = false) =>
      (await q(`insert into org_teams (org, name, gender, grade_low, grade, level, created_by${archived ? ", archived_at" : ""}) values ('club', $1, 'Boys', 5, 5, 'REC', 't'${archived ? ", now()" : ""}) returning id::text`, [name]))[0].id;
    const [a, b, c, d, old] = [await team("5B A"), await team("5B B"), await team("6B C"), await team("6B D"), await team("4B Old", true)];
    await q(
      `insert into org_team_coaches (team_id, coach_id, role, added_by) values
         ($1, '5550001', 'HeadCoach', 't'), ($2, '5550001', 'HeadCoach', 't'), ($3, '5550001', 'AsstCoach', 't'),
         ($1, '5550002', 'AsstCoach', 't'), ($4, '5550002', 'AsstCoach', 't'), ($5, '5550002', 'HeadCoach', 't'), ($3, '5550002', 'Manager', 't')`,
      [a, b, c, d, old],
    );
    expect(await busyCoaches(db.pool, "club", NOW)).toEqual([{ coachId: "5550001", name: "Al X", teams: [{ id: a, name: "5B A" }, { id: b, name: "5B B" }, { id: c, name: "6B C" }] }]);
    expect(await busyCoaches(db.pool, "thunder", NOW)).toEqual([]);
    // Thunder: team staff.
    const t = async (name: string) => (await q("insert into teams (name, gender, grades, grade_sort, level, created_by) values ($1, 'Boys', '{5}', 5, 'REC', 'x') returning id::text", [name]))[0].id;
    const ts = [await t("5B One"), await t("5B Two"), await t("5B Three")];
    for (const id of ts) await q("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550002', 'AsstCoach', 'x')", [id]);
    expect((await busyCoaches(db.pool, "thunder", NOW)).map((x) => [x.name, x.teams.length])).toEqual([["Bo Y", 3]]);
  }, 60_000);
});
