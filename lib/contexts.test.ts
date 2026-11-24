import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { pickContext, userContexts } from "./contexts";
import { createTestDb, grant } from "./testing/db";

const base: SessionUser = { coachId: "5550001", firstName: "Pat", lastName: "Test", isDirector: false, isCoach: true, requestPending: false, hasThunderRole: true };

describe("userContexts", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => {
    await db?.drop();
  });
  beforeEach(async () => {
    await db.reset();
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Pat', 'Test', '4235550001')");
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values
         ('4G Test', 'Girls', '{4}', 4, 'REC', 'x'), ('10B Other', 'Boys', '{10}', 10, 'COMP', 'x'), ('2B Other', 'Boys', '{2}', 2, 'REC', 'x')
       returning id::text`,
    );
    const [g4, b10, b2] = t.rows.map((r) => r.id);
    await db.pool.query(
      `insert into team_staff (team_id, coach_id, role, added_by) values
         ($1, '5550001', 'HeadCoach', 'x'), ($2, '5550001', 'TeamParent', 'x'), ($3, '5550001', 'Manager', 'x'), ($3, '5550001', 'AsstCoach', 'x')`,
      [g4, b10, b2],
    );
  });

  it("Director first, then one chip per team (highest role), in team order", async () => {
    const c = await userContexts(db.pool, { ...base, isDirector: true });
    expect(c.map((x) => x.label)).toEqual(["Director", "2B Other · Asst Coach", "4G Test · Head Coach", "10B Other · Team Parent"]);
    expect(c[0].href).toBe("/org/thunder"); // Thunder's Home, like every organization's
    expect(c[1].href).toMatch(/^\/org\/thunder\/teams\/\d+$/);
  });

  it("no Director chip for non-Directors; none at all with no roles", async () => {
    expect((await userContexts(db.pool, base)).map((x) => x.key)).not.toContain("director");
    await db.pool.query("delete from team_staff");
    expect(await userContexts(db.pool, base)).toEqual([]);
  });

  it("one Scenic City chip per Scenic City role (Director, Partner, Solo, Coach order); a Request alone gives none", async () => {
    await grant(db.pool, "5550001 scenic-city Request");
    expect((await userContexts(db.pool, base)).some((x) => x.org === "scenic-city")).toBe(false);
    await grant(db.pool, "5550001 scenic-city Coach", "5550001 scenic-city Partner");
    const c = await userContexts(db.pool, { ...base, isDirector: true });
    expect(c.map((x) => `${x.org}:${x.label}`)).toEqual([
      "thunder:Director",
      "thunder:2B Other · Asst Coach",
      "thunder:4G Test · Head Coach",
      "thunder:10B Other · Team Parent",
      "scenic-city:Partner",
      "scenic-city:Coach",
    ]);
    expect(c.at(-2)).toMatchObject({ key: "scenic:Partner", href: "/org/scenic-city", role: "Partner" });
  });

  it("a registered organization's team staff get a chip per team (its page); a Coach role adds no Home chip then", async () => {
    await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('east-ridge', 'East Ridge', 'ER', 'Organization')");
    await db.pool.query("insert into org_role_types (org, role) values ('east-ridge', 'Admin'), ('east-ridge', 'Coach')");
    const t = await db.pool.query<{ id: string }>(
      `insert into org_teams (org, name, gender, grade_low, grade, level, created_by)
       values ('east-ridge', '5B Ace', 'Boys', 5, 5, 'REC', 'x') returning id::text`,
    );
    await db.pool.query("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x')", [
      t.rows[0].id,
    ]);
    await grant(db.pool, "5550001 east-ridge Coach");
    const er = (await userContexts(db.pool, base)).filter((x) => x.org === "east-ridge");
    expect(er).toEqual([
      expect.objectContaining({
        key: `orgteam:east-ridge:${t.rows[0].id}`,
        label: "5B Ace · Head Coach",
        href: `/org/east-ridge/teams/${t.rows[0].id}`,
      }),
    ]);
    await grant(db.pool, "5550001 east-ridge Admin"); // an Admin keeps the Home chip too
    expect((await userContexts(db.pool, base)).filter((x) => x.org === "east-ridge").map((x) => x.label)).toEqual([
      "Admin",
      "5B Ace · Head Coach",
    ]);
    await db.pool.query("delete from org_roles where org = 'east-ridge'");
    await db.pool.query("delete from org_role_types where org = 'east-ridge'");
    await db.pool.query("delete from organizations where slug = 'east-ridge'");
  });

  it("remembers the last context only while the person still holds it", async () => {
    const c = await userContexts(db.pool, { ...base, isDirector: true });
    expect(pickContext(c, c[2].key)).toBe(c[2]);
    expect(pickContext(c, "team:999999")).toBe(c[0]);
    expect(pickContext(c, undefined)).toBe(c[0]);
    expect(pickContext([], "director")).toBeNull();
  });
});
