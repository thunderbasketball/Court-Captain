import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEATURES, RETIRED_KEYS, abilitiesFrom, hasFeature, orgFeatureKeys, orgFeatures, syncPart } from "./features";
import { createTestDb } from "./testing/db";

describe("organization features", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });

  it("gives each organization its CourtCaptain features, and the abilities they bring", async () => {
    expect([...(await orgFeatureKeys(db.pool, "thunder"))].sort()).toEqual(
      ["alerts", "court-facility", "court-players", "court-sync"].sort(),
    );
    expect([...(await orgFeatureKeys(db.pool, "scenic-city"))].sort()).toEqual(
      ["alerts", "court-scheduler", "court-teams"].sort(),
    );
    // The same abilities as before the features were named, plus Chat (with CourtSync, CourtTeams or CourtScheduler).
    expect([...(await orgFeatures(db.pool, "thunder"))].sort()).toEqual(
      ["alerts", "chat", "events", "hosting-available", "player-registration", "practice", "team-building", "uniforms"].sort(),
    );
    expect([...(await orgFeatures(db.pool, "scenic-city"))].sort()).toEqual(
      ["alerts", "chat", "hosting-partners", "officials", "programs", "team-registration"].sort(),
    );
  });

  it("CourtSync is Schedule with CourtScheduler, else Host; CourtOrg manages teams", () => {
    expect(syncPart(new Set(["court-sync"]))).toBe("Host");
    expect(syncPart(new Set(["court-sync", "court-scheduler"]))).toBe("Schedule");
    expect([...abilitiesFrom(["court-sync", "court-scheduler"])]).not.toContain("hosting-available");
    expect([...abilitiesFrom(["court-org", "court-sync"])].sort()).toEqual(
      ["alerts", "chat", "hosting-available", "team-building"].sort(),
    );
    expect([...abilitiesFrom(["court-sync"])].sort()).toEqual(["alerts", "chat", "hosting-available"].sort());
    expect([...abilitiesFrom(["team-building", "chat"])]).toEqual(["alerts"]); // old keys are ignored
  });

  it("answers per organization, and Alerts is always on", async () => {
    expect(await hasFeature(db.pool, "thunder", "practice")).toBe(true);
    expect(await hasFeature(db.pool, "scenic-city", "practice")).toBe(false);
    expect(await hasFeature(db.pool, "scenic-city", "hosting-partners")).toBe(true);
    expect(await hasFeature(db.pool, "thunder", "hosting-partners")).toBe(false);
    expect(await hasFeature(db.pool, "scenic-city", "alerts")).toBe(true);
  });

  it("turns a feature off and back on", async () => {
    await db.pool.query("delete from org_features where org = 'thunder' and feature = 'court-players'");
    expect(await hasFeature(db.pool, "thunder", "uniforms")).toBe(false);
    await db.pool.query("insert into org_features (org, feature, source) values ('thunder', 'court-players', 'setup')");
    expect(await hasFeature(db.pool, "thunder", "uniforms")).toBe(true);
  });

  it("stores only feature keys the app knows (or old ones left for the live site)", async () => {
    const r = await db.pool.query<{ feature: string }>("select distinct feature from org_features");
    const known = new Set<string>([...FEATURES.map((f) => f.key), ...RETIRED_KEYS]);
    expect(r.rows.every((x) => known.has(x.feature))).toBe(true);
  });
});
