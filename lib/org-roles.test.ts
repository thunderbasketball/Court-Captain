import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, grant } from "./testing/db";

// db/migrations/023 + 025: organizations, the roles each offers, and who holds them (SPEC.md section 13).
describe("org_roles", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => db.drop());
  beforeEach(async () => {
    await db.reset();
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('1000001', 'A', 'B', '4231000001')");
  });

  const roles = async () =>
    (await db.pool.query<{ r: string }>("select org || ':' || role || ':' || coalesce(granted_by, '') as r from org_roles order by 1")).rows.map(
      (x) => x.r,
    );
  const has = async (org: string, role: string) =>
    (await db.pool.query("select has_role('1000001', $1, $2) as h", [org, role])).rows[0].h;

  it("has Thunder and Scenic City with their roles", async () => {
    const r = await db.pool.query("select org || ':' || role as r from org_role_types order by 1");
    expect(r.rows.map((x) => x.r)).toEqual([
      "scenic-city:Admin",
      "scenic-city:Coach",
      "scenic-city:Director",
      "scenic-city:Owner",
      "scenic-city:Partner",
      "scenic-city:Request",
      "scenic-city:Solo",
      "thunder:Admin",
      "thunder:Coach",
      "thunder:Director",
      "thunder:Owner",
      "thunder:Request",
    ]);
  });

  it("set_role grants and removes; granting again keeps who first granted it", async () => {
    await db.pool.query("select set_role('1000001', 'scenic-city', 'Partner', true, 'Earl Epps')");
    await db.pool.query("select set_role('1000001', 'scenic-city', 'Partner', true, 'Someone Else')");
    await db.pool.query("select set_role('1000001', 'thunder', 'Coach', true, 'Earl Epps')");
    expect(await roles()).toEqual(["scenic-city:Partner:Earl Epps", "thunder:Coach:Earl Epps"]);
    expect(await has("scenic-city", "Partner")).toBe(true);
    expect(await has("thunder", "Director")).toBe(false);
    await db.pool.query("select set_role('1000001', 'scenic-city', 'Partner', false, 'Earl Epps')");
    expect(await roles()).toEqual(["thunder:Coach:Earl Epps"]);
  });

  it("removes roles when the user is deleted", async () => {
    await grant(db.pool, "1000001 thunder Coach");
    await db.pool.query("delete from users where coach_id = '1000001'");
    expect(await roles()).toEqual([]);
  });

  it("refuses a role an organization doesn't offer", async () => {
    await expect(db.pool.query("select set_role('1000001', 'thunder', 'Partner', true, 'x')")).rejects.toThrow();
  });
});
