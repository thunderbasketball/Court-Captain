import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { myLeagueTeams } from "./my-league-teams";
import { createTestDb } from "./testing/db";

describe("My teams on an organization's main page (logged in)", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const one = async (sql: string, p: unknown[] = []) => (await db.pool.query<{ id: string }>(sql, p)).rows[0]?.id;
  const NOW = new Date("2026-11-28T15:00:00Z");

  it("a coach's or staff's teams in current League programs: on its own organization's page, and all of them on the League's", async () => {
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Co', 'A', '4235550001'), ('5550002', 'Mo', 'B', '4235550002')",
    );
    await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('club', 'Club', 'CL', 'Organization')");
    const prog = await one(
      "insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by) values ('League', 'W', '2026-12-05', '2027-02-28', '2026-10-01', '2027-01-31', 't', 't') returning id::text",
    );
    const div = await one("insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Boys', 5, 5) returning id::text", [prog]);
    const g = await one("insert into scenic_grade_groups (division_id, grade, level) values ($1, 5, 'REC') returning id::text", [div]);
    const pool = await one("insert into scenic_pools (group_id, name) values ($1, 'A') returning id::text", [g]);
    // A Thunder team (Co is its Assistant Coach), a club's team (Co coaches it), and one nobody here is on.
    const thunder = await one("insert into teams (name, gender, grades, grade_sort, level, created_by) values ('5B T', 'Boys', '{5}', 5, 'REC', 't') returning id::text");
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'AsstCoach', 't')", [thunder]);
    const clubTeam = await one("insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('club', '5B C', 'Boys', 5, 5, 'REC', 't') returning id::text");
    await db.pool.query("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 't')", [clubTeam]);
    const league = async (name: string, link: { thunder?: string; org?: string }) => {
      const id = await one(
        `insert into scenic_teams (name, gender, grade_low, grade, level, coach_id, owner_coach_id, thunder_team_id, org_team_id, created_by, updated_by)
         values ($1, 'Boys', 5, 5, 'REC', '5550002', '5550002', $2, $3, 't', 't') returning id::text`,
        [name, link.thunder ?? null, link.org ?? null],
      );
      await db.pool.query("insert into scenic_registrations (program_id, team_id, pool_id, registered_by) values ($1, $2, $3, 't')", [prog, id, pool]);
      return id!;
    };
    const t = await league("5B T", { thunder });
    const c = await league("5B C", { org: clubTeam });
    await league("5B Solo", {}); // Mo's own League team, not Co's

    expect(await myLeagueTeams(db.pool, "5550001", "thunder", NOW, false)).toEqual([t]);
    expect(await myLeagueTeams(db.pool, "5550001", "club", NOW, false)).toEqual([c]);
    expect((await myLeagueTeams(db.pool, "5550001", "scenic-city", NOW, true)).sort()).toEqual([t, c].sort()); // the League: all of them
    expect(await myLeagueTeams(db.pool, "5550002", "thunder", NOW, false)).toEqual([]);
    expect(await myLeagueTeams(db.pool, "5550001", "thunder", new Date("2027-04-01T15:00:00Z"), false)).toEqual([]); // the season's over
  });
});
