import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { userContexts } from "./contexts";
import { hasFeature } from "./features";
import { isPlatformAdmin, platformOverview, setOrgOwner, setOrgFeature, setPlatformAdmin } from "./platform";
import { directorsPanel, isOrgOwner, orgHasArea } from "./org-admin";
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
    expect(await setOrgFeature(deps(), director, "thunder", "uniforms", false)).toEqual({
      ok: false,
      message: "Only a CourtCaptain Admin can do that.",
    });
    expect(await setOrgOwner(deps(), director, "thunder", "5550003", true)).toMatchObject({ ok: false });
    expect(await hasFeature(db.pool, "thunder", "uniforms")).toBe(true);
  });

  it("turns features on (free) and off; Alerts and unknown features are refused", async () => {
    expect(await setOrgFeature(deps(), admin, "scenic-city", "chat", true)).toEqual({ ok: true });
    const row = await db.pool.query(
      "select source, turned_on_by from org_features where org = 'scenic-city' and feature = 'chat'",
    );
    expect(row.rows[0]).toEqual({ source: "comp", turned_on_by: "5550001" });
    expect(await setOrgFeature(deps(), admin, "scenic-city", "chat", false)).toEqual({ ok: true });
    expect(await hasFeature(db.pool, "scenic-city", "chat")).toBe(false);
    expect(await setOrgFeature(deps(), admin, "thunder", "alerts", false)).toMatchObject({ ok: false });
    expect(await setOrgFeature(deps(), admin, "thunder", "rockets", true)).toMatchObject({ ok: false });
    expect(await setOrgFeature(deps(), admin, "nowhere", "chat", true)).toMatchObject({ ok: false });
    // A registered organization only gets features that work for it today.
    await db.pool.query(
      "insert into organizations (slug, name, short_name, kind) values ('east-ridge', 'East Ridge', 'ER', 'Organization')",
    );
    try {
      expect(await setOrgFeature(deps(), admin, "east-ridge", "uniforms", true)).toMatchObject({ ok: false });
      expect(await setOrgFeature(deps(), admin, "east-ridge", "team-building", true)).toEqual({ ok: true });
    } finally {
      await db.pool.query("delete from organizations where slug = 'east-ridge'");
    }
  });

  it("sets Owners per organization (they also get Admin and Director), keeps at least one, and shows Admins and Directors", async () => {
    await grant(db.pool, "5550003 scenic-city Request");
    expect(await setOrgOwner(deps(), admin, "scenic-city", "5550003", true)).toEqual({ ok: true });
    const roles = await db.pool.query(
      "select role, granted_by from org_roles where coach_id = '5550003' and org = 'scenic-city' order by role",
    );
    expect(roles.rows.map((r) => r.role)).toEqual(["Admin", "Director", "Owner"]); // the Request is cleared
    expect(roles.rows[0].granted_by).toBe("Pat 5550001");
    await grant(db.pool, "5550001 thunder Admin", "5550001 thunder Director");
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('5550002', 'thunder', 'players', 'test')",
    );

    const view = await platformOverview(deps(), admin);
    const scenic = view!.orgs.find((o) => o.slug === "scenic-city")!;
    const thunder = view!.orgs.find((o) => o.slug === "thunder")!;
    expect(scenic.owners.map((d) => d.id)).toEqual(["5550003"]);
    expect(scenic.admins).toEqual([]);
    expect(scenic.options.map((d) => d.id)).not.toContain("5550003");
    expect(thunder.owners).toEqual([]);
    expect(thunder.admins).toEqual([]); // CourtCaptain staff stay in the background, even with a role there
    expect(thunder.directors).toEqual([
      { id: "5550002", name: "Bo Other", cell: "4235550002", owner: false, admin: false, areas: ["players"] },
    ]);
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

  it("CourtCaptain staff: Owner-level access to every organization in the background; Owners add and remove Admins", async () => {
    const org = "scenic-city";
    // Ada (staff) holds no Scenic City role, yet passes its Owner and Admin checks and areas, and isn't listed.
    expect(await isOrgOwner(db.pool, admin.coachId, org)).toBe(true);
    expect(await orgHasArea(db.pool, admin.coachId, org, "scheduling")).toBe(true);
    expect((await directorsPanel(deps(), admin, org))!.directors.map((d) => d.id)).not.toContain(admin.coachId);
    expect((await userContexts(db.pool, admin)).map((c) => c.key)).toContain("scenic:Director");
    expect(await isOrgOwner(db.pool, "5550002", org)).toBe(false);

    // Ada is an Owner (the first staff are): adds Bo as Admin, removes him; Owners can't be removed; Admins can't add.
    await db.pool.query("update platform_admins set role = 'Owner' where coach_id = $1", [admin.coachId]);
    expect(await setPlatformAdmin(deps(), admin, "5550002", true)).toEqual({ ok: true });
    expect(await isOrgOwner(db.pool, "5550002", org)).toBe(true);
    const bo = { ...admin, coachId: "5550002" };
    expect(await setPlatformAdmin(deps(), bo, "5550003", true)).toEqual({
      ok: false,
      message: "Only a CourtCaptain Owner can do that.",
    });
    expect(await setPlatformAdmin(deps(), admin, admin.coachId, false)).toEqual({
      ok: false,
      message: "CourtCaptain Owners can't be removed.",
    });
    expect((await platformOverview(deps(), admin))!.platformAdmins.map((a) => `${a.id} ${a.role}`)).toEqual([
      "5550001 Owner",
      "5550002 Admin",
    ]);
    expect(await setPlatformAdmin(deps(), admin, "5550002", false)).toEqual({ ok: true });
    expect(await isOrgOwner(db.pool, "5550002", org)).toBe(false);
  });
});
