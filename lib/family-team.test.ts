import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSession } from "./auth/service";
import { familyTeams } from "./family-team";
import { createTestDb } from "./testing/db";

describe("parents' teams", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  const now = new Date("2026-11-25T15:00:00Z");
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  it("a verified parent is connected at login (Family, not staff) and sees only their players' teams, no other contacts", async () => {
    const q = (s: string, a: unknown[] = []) => db.pool.query(s, a);
    const deps = { pool: db.pool, now: () => now } as never;
    const user = (id: string, email: string | null, verified: string | null) =>
      q("insert into users (coach_id, first_name, last_name, cell, email, verified_email) values ($1, 'U', $1, $2, $3, $4)", [id, `423${id}`, email, verified]);
    await user("5550001", "Mom@x.com", "mom@x.com"); // verified parent
    await user("5550002", "dad@x.com", null); // parent, not verified
    await user("5550003", "c@x.com", "c@x.com"); // a parent who coaches
    await user("5550004", "n@x.com", "n@x.com"); // nobody's parent
    const reg = (id: string, first: string, p1: string, p2: string | null) =>
      q(
        `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, parent1_cell, parent2_cell, raw, imported_at, imported_by)
         values ($1, $1, $2, 'Lee', 'Girls', '4', 4, 'x', $3, $4, '{}', now(), 'x')`,
        [id, first, p1, p2],
      );
    await reg("r1", "Ann", "4235550001", "4235550002");
    await reg("r2", "Bea", "4235550003", null);
    const team = async (name: string) => (await q("insert into teams (name, gender, grades, grade_sort, level, created_by) values ($1, 'Girls', '{4}', 4, 'REC', 'x') returning id::text", [name])).rows[0].id as string;
    const a = await team("4G A");
    const b = await team("4G B");
    for (const [t, p, first] of [[a, "r1", "Ann"], [a, "r2", "Bea"]] as const)
      await q("insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at) values ($1, $2, $3, 'Lee', 'Girls', '4', 4, 'x', now())", [t, p, first]);
    await q("insert into team_uniforms (team_id, registrant_id, number, size, updated_by, updated_at) values ($1, 'r1', '5', 'YL', 'x', now())", [a]);
    await q("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550003', 'HeadCoach', 'x')", [b]);

    const roles = async (id: string) => {
      await startSession(deps, db.pool, id);
      return (await q("select org || ':' || role as r, 1 from org_roles where coach_id = $1 and org = 'thunder' order by 1", [id])).rows.map((x) => x.r);
    };
    expect(await roles("5550001")).toEqual(["thunder:Family"]);
    expect(await roles("5550001")).toEqual(["thunder:Family"]); // again: the same
    expect(await roles("5550002")).toEqual([]);
    expect(await roles("5550003")).toEqual([]);
    expect(await roles("5550004")).toEqual([]);

    expect(await familyTeams(deps, "5550004")).toBeNull();
    expect(await familyTeams(deps, "5550002")).toEqual({ verified: false, teams: [] });
    const f = (await familyTeams(deps, "5550001"))!;
    expect(f.teams).toMatchObject([{ name: "4G A", kids: [{ name: "Ann Lee", number: "5", size: "YL" }], roster: [{ name: "Ann L.", number: "5" }, { name: "Bea L.", number: null }], staff: [] }]);
    expect(JSON.stringify(f)).not.toContain("4235550003"); // another family's cell
    await q("delete from team_players where registrant_id = 'r1'"); // off the team: gone at once
    expect((await familyTeams(deps, "5550001"))!.teams).toEqual([]);
  }, 120_000);
});
