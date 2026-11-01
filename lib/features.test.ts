import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEATURES, hasFeature, orgFeatures } from "./features";
import { createTestDb } from "./testing/db";

describe("organization features", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });

  it("gives Thunder and Scenic City their own features, plus Alerts for both", async () => {
    expect([...(await orgFeatures(db.pool, "thunder"))].sort()).toEqual(
      ["alerts", "chat", "events", "hosting-available", "player-registration", "practice", "team-building", "uniforms"].sort(),
    );
    expect([...(await orgFeatures(db.pool, "scenic-city"))].sort()).toEqual(
      ["alerts", "hosting-partners", "officials", "programs", "team-registration"].sort(),
    );
  });

  it("answers per organization, and Alerts is always on", async () => {
    expect(await hasFeature(db.pool, "thunder", "practice")).toBe(true);
    expect(await hasFeature(db.pool, "scenic-city", "practice")).toBe(false);
    expect(await hasFeature(db.pool, "scenic-city", "hosting-partners")).toBe(true);
    expect(await hasFeature(db.pool, "thunder", "hosting-partners")).toBe(false);
    expect(await hasFeature(db.pool, "scenic-city", "alerts")).toBe(true);
  });

  it("turns a feature off and back on", async () => {
    await db.pool.query("delete from org_features where org = 'thunder' and feature = 'uniforms'");
    expect(await hasFeature(db.pool, "thunder", "uniforms")).toBe(false);
    await db.pool.query("insert into org_features (org, feature, source) values ('thunder', 'uniforms', 'setup')");
    expect(await hasFeature(db.pool, "thunder", "uniforms")).toBe(true);
  });

  it("stores only feature keys the app knows", async () => {
    const r = await db.pool.query<{ feature: string }>("select distinct feature from org_features");
    const known = new Set<string>(FEATURES.map((f) => f.key));
    expect(r.rows.every((x) => known.has(x.feature))).toBe(true);
  });
});
