import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FEATURES, RETIRED_KEYS, abilitiesFrom, hasFeature, orgFeatureKeys, orgFeatures, setCourtSync, syncPart } from "./features";
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
    // CourtClub, CourtFacilities and Alerts come with every organization.
    expect([...(await orgFeatureKeys(db.pool, "thunder"))].sort()).toEqual(
      ["alerts", "court-club", "court-facilities", "court-players", "court-sync"].sort(),
    );
    // CourtScheduler became part of CourtTeams, its CourtSync Scheduler part CourtSync itself (110_feature_layout.sql).
    expect([...(await orgFeatureKeys(db.pool, "scenic-city"))].sort()).toEqual(
      ["alerts", "court-club", "court-facilities", "court-sync", "court-teams"].sort(),
    );
    // CourtPlayers brings practice (CourtPractice) and chat; CourtOfficials is its own feature now.
    expect([...(await orgFeatures(db.pool, "thunder"))].sort()).toEqual(
      ["alerts", "chat", "events", "hosting-available", "player-registration", "practice", "team-building", "team-chat", "uniforms"].sort(),
    );
    expect([...(await orgFeatures(db.pool, "scenic-city"))].sort()).toEqual(
      ["alerts", "chat", "hosting-partners", "programs", "team-building", "team-registration"].sort(),
    );
  });

  it("CourtSync is the Scheduler part with CourtTeams, else Host; CourtPractice and CourtOfficials on their own", () => {
    expect(syncPart(new Set(["court-sync"]))).toBe("Host");
    expect(syncPart(new Set(["court-sync", "court-teams"]))).toBe("Schedule");
    expect([...abilitiesFrom(["court-sync", "court-teams"])]).not.toContain("hosting-available");
    expect([...abilitiesFrom(["court-sync", "court-teams"])]).toContain("hosting-partners");
    expect([...abilitiesFrom(["court-teams"])]).not.toContain("hosting-partners"); // the Scheduler part needs CourtSync on
    expect([...abilitiesFrom(["court-sync"])].sort()).toEqual(["alerts", "hosting-available", "team-building"].sort()); // no chat (Scheduler ↔ Host chat comes later)
    expect([...abilitiesFrom(["court-practice"])]).toContain("practice");
    expect([...abilitiesFrom(["court-officials"])]).toContain("officials"); // an officials group
    expect([...abilitiesFrom(["court-teams", "court-sync"])]).not.toContain("officials");
    expect(syncPart(new Set(["court-officials", "court-sync"]))).toBe("Officials");
    expect([...abilitiesFrom(["court-officials", "court-sync"], false)]).not.toContain("hosting-available"); // an Officials Group: not a gym host
    // A League with gyms (CourtFacilities) and CourtOfficials stays a CourtSync Host.
    expect(syncPart(new Set(["court-officials", "court-sync", "court-facilities"]))).toBe("Host");
    expect([...abilitiesFrom(["court-officials", "court-sync"])]).toContain("hosting-available");
    expect([...abilitiesFrom(["team-building", "court-scheduler", "court-facility"])].sort()).toEqual(["alerts", "team-building"]); // old keys ignored
  });

  it("CourtSync: the organization's Owners and Admins turn it on and off", async () => {
    const deps = { pool: db.pool, now: () => new Date() };
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Al', 'X', '4235550001') on conflict do nothing");
    const al = { coachId: "5550001", firstName: "Al", lastName: "X" };
    expect(await setCourtSync(deps, al, "thunder", false)).toMatchObject({ ok: false });
    await db.pool.query("select set_role('5550001', 'thunder', 'Admin', true, 'test')");
    expect(await setCourtSync(deps, al, "thunder", "off")).toMatchObject({ ok: false });
    expect(await setCourtSync(deps, al, "thunder", false)).toEqual({ ok: true });
    expect(await hasFeature(db.pool, "thunder", "hosting-available")).toBe(false);
    expect(await setCourtSync(deps, al, "thunder", true)).toEqual({ ok: true });
    expect(await hasFeature(db.pool, "thunder", "hosting-available")).toBe(true);
    const r = await db.pool.query("select source, turned_on_by from org_features where org = 'thunder' and feature = 'court-sync'");
    expect(r.rows[0]).toEqual({ source: "org", turned_on_by: "Al X" });
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
