import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { userContexts } from "./contexts";
import { hasFeature } from "./features";
import { isPlatformAdmin, platformOverview, setOrgOwner, setOrgFeature } from "./platform";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string): SessionUser => ({
  coachId,
  firstName: "Pat",
  lastName: coachId,
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const admin = person("5550001");
const other = person("5550002");

describe("CourtCaptain Admin", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-10-31T12:00:00Z") });
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('5550001', 'Ada', 'Admin', '4235550001'), ('5550002', 'Bo', 'Other', '4235550002'), ('5550003', 'Cy', 'Third', '4235550003')`,
    );
    await db.pool.query("insert into platform_admins (coach_id, granted_by) values ('5550001', 'test')");
    await grant(db.pool, "5550002 thunder Director");
  });

  it("is re-read from the database, and gives an Admin chip last", async () => {
    expect(await isPlatformAdmin(db.pool, admin.coachId)).toBe(true);
    expect(await isPlatformAdmin(db.pool, other.coachId)).toBe(false);
    const chips = await userContexts(db.pool, admin);
    expect(chips.at(-1)).toMatchObject({ key: "platform", org: "courtcaptain", href: "/platform" });
    expect((await userContexts(db.pool, { ...other, isDirector: true })).some((c) => c.key === "platform")).toBe(false);
  });

  it("only admins see the platform or change anything (a Director isn't enough)", async () => {
    const director = { ...other, isDirector: true };
    expect(await platformOverview(deps(), director)).toBeNull();
    expect(await setOrgFeature(deps(), director, "thunder", "uniforms", false)).toEqual({ ok: false, message: "Only a CourtCaptain Admin can do that." });
    expect(await setOrgOwner(deps(), director, "thunder", "5550003", true)).toMatchObject({ ok: false });
    expect(await hasFeature(db.pool, "thunder", "uniforms")).toBe(true);
  });

  it("turns features on (free) and off; Alerts and unknown features are refused", async () => {
    expect(await setOrgFeature(deps(), admin, "scenic-city", "chat", true)).toEqual({ ok: true });
    const row = await db.pool.query("select source, turned_on_by from org_features where org = 'scenic-city' and feature = 'chat'");
    expect(row.rows[0]).toEqual({ source: "comp", turned_on_by: "5550001" });
    expect(await setOrgFeature(deps(), admin, "scenic-city", "chat", false)).toEqual({ ok: true });
    expect(await hasFeature(db.pool, "scenic-city", "chat")).toBe(false);
    expect(await setOrgFeature(deps(), admin, "thunder", "alerts", false)).toMatchObject({ ok: false });
    expect(await setOrgFeature(deps(), admin, "thunder", "rockets", true)).toMatchObject({ ok: false });
    expect(await setOrgFeature(deps(), admin, "nowhere", "chat", true)).toMatchObject({ ok: false });
  });

  it("sets Owners per organization (they also get Admin and Director), keeps at least one, and shows Admins and Directors", async () => {
    await grant(db.pool, "5550003 scenic-city Request");
    expect(await setOrgOwner(deps(), admin, "scenic-city", "5550003", true)).toEqual({ ok: true });
    const roles = await db.pool.query("select role, granted_by from org_roles where coach_id = '5550003' and org = 'scenic-city' order by role");
    expect(roles.rows.map((r) => r.role)).toEqual(["Admin", "Director", "Owner"]); // the Request is cleared
    expect(roles.rows[0].granted_by).toBe("Pat 5550001");
    await grant(db.pool, "5550001 thunder Admin", "5550001 thunder Director");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('5550002', 'thunder', 'players', 'test')");

    const view = await platformOverview(deps(), admin);
    const scenic = view!.orgs.find((o) => o.slug === "scenic-city")!;
    const thunder = view!.orgs.find((o) => o.slug === "thunder")!;
    expect(scenic.owners.map((d) => d.id)).toEqual(["5550003"]);
    expect(scenic.admins).toEqual([]);
    expect(scenic.options.map((d) => d.id)).not.toContain("5550003");
    expect(thunder.owners).toEqual([]);
    expect(thunder.admins).toEqual([{ id: "5550001", name: "Ada Admin" }]);
    expect(thunder.directors).toEqual([{ id: "5550002", name: "Bo Other", owner: false, admin: false, areas: ["players"] }]);
    expect(view!.platformAdmins.map((a) => a.id)).toEqual(["5550001"]);

    expect(await setOrgOwner(deps(), admin, "scenic-city", "5550003", false)).toEqual({
      ok: false,
      message: "Scenic City Basketball needs at least one Owner.",
    });
    expect(await setOrgOwner(deps(), admin, "thunder", "5550003", true)).toEqual({ ok: true });
    expect(await setOrgOwner(deps(), admin, "thunder", "5550002", true)).toEqual({ ok: true });
    expect(await setOrgOwner(deps(), admin, "thunder", "5550003", false)).toEqual({ ok: true });
    const left = await db.pool.query("select role from org_roles where coach_id = '5550003' and org = 'thunder' order by role");
    expect(left.rows.map((r) => r.role)).toEqual(["Admin", "Director"]); // stays an Admin
    expect(await setOrgOwner(deps(), admin, "thunder", "bad", true)).toMatchObject({ ok: false });
  });
});
