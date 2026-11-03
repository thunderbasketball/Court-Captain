import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { createOrganization, renameOrg, renamedTo } from "./org-signup";
import { createOrgTeam } from "./org-teams";
import { createTestDb } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const owner = person("5550001", "Jo");
const admin = person("5550002", "Bo");

describe("renaming an organization", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-03T15:00:00Z") });

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jo', 'X', '4235550001'),
         ('5550002', 'Bo', 'X', '4235550002')`,
    );
  });

  it("fixes a typo: the address follows the name, everything follows it, and the old address still finds it", async () => {
    const made = await createOrganization(
      deps(),
      owner,
      { name: "Esst Hamilton High Dchool", short: "East Ham", kind: "School", color: "#1d4ed8", features: ["team-building"] },
      null,
    );
    expect(made).toMatchObject({ ok: true, slug: "esst-hamilton-high-dchool" });
    const old = "esst-hamilton-high-dchool";
    await db.pool.query("select set_role('5550002', $1, 'Admin', true, 'test')", [old]);
    const team = await createOrgTeam(deps(), owner, old, {
      gender: "Boys",
      grades: ["9"],
      level: "COMP",
      headCoach: "none",
    } as Parameters<typeof createOrgTeam>[3]);
    expect(team).toMatchObject({ ok: true });

    const input = { name: "East Hamilton High School", short: "East Ham" };
    expect(await renameOrg(deps(), admin, old, input)).toMatchObject({ ok: false }); // an Admin isn't enough
    expect(await renameOrg(deps(), owner, old, { name: "=cmd", short: "x" })).toMatchObject({ ok: false });
    expect(await renameOrg(deps(), owner, old, input)).toEqual({ ok: true, slug: "east-hamilton-high-school" });

    const now = "east-hamilton-high-school";
    const has = async (sql: string) => (await db.pool.query(sql, [now])).rows[0].ok;
    expect(await has("select name = 'East Hamilton High School' as ok from organizations where slug = $1")).toBe(true);
    expect(await has("select has_role('5550001', $1, 'Owner') and has_role('5550002', $1, 'Admin') as ok")).toBe(true);
    expect(await has("select count(*) = 1 as ok from org_teams where org = $1")).toBe(true);
    expect(await has("select count(*) = 1 as ok from org_features where org = $1")).toBe(true);
    expect(await has("select not exists (select 1 from org_roles where org = 'esst-hamilton-high-dchool') and $1 <> '' as ok")).toBe(true);
    expect(await renamedTo(db.pool, old)).toBe(now);

    // Changing only the short name keeps the address; Thunder keeps its address whatever its name.
    expect(await renameOrg(deps(), owner, now, { name: "East Hamilton High School", short: "EHHS" })).toEqual({
      ok: true,
      slug: now,
    });
    await db.pool.query("select set_role('5550001', 'thunder', 'Owner', true, 'test')");
    expect(await renameOrg(deps(), owner, "thunder", { name: "Thunder Hoops", short: "Thunder" })).toEqual({
      ok: true,
      slug: "thunder",
    });
  });
});
