import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { userContexts } from "./contexts";
import { hasFeature } from "./features";
import { listOrgs, orgInfo } from "./org-registry";
import { addOrgGym, availableUses, facilitiesView, removeOrgGym, setAvailability } from "./facilities";
import { decideHosting, hostingOffers, hostingRequests, requestHosting } from "./org-partnerships";
import { createOrganization, logoType, setOrgColor, setOrgLogo, slugFor } from "./org-signup";
import { openCourtsByDay, partnerHours } from "./scenic-partners";
import { createTestDb, grant } from "./testing/db";

const jo: SessionUser = {
  coachId: "5550001",
  firstName: "Jordan",
  lastName: "Harris",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
};
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("registering an organization", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-02T15:00:00Z") });
  const input = {
    name: "Baylor School",
    short: "Baylor",
    kind: "School",
    color: "#0f766e",
    features: ["hosting-available", "practice"],
  };

  beforeEach(async () => {
    await db.reset();
    // Registered organizations outlive a reset (organizations are kept); clear them.
    await db.pool.query("delete from gyms where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jordan', 'Harris', '4235550001')",
    );
  });

  it("is live at once: the person registering is its Owner; ready features turn on, the rest are requested", async () => {
    expect(await createOrganization(deps(), jo, input, { bytes: png, type: "image/png" })).toEqual({
      ok: true,
      slug: "baylor-school",
      on: ["hosting-available"],
      requested: ["practice"],
    });
    const o = await orgInfo(db.pool, "baylor-school");
    expect(o).toMatchObject({
      name: "Baylor School",
      short: "Baylor",
      kind: "School",
      color: "#0f766e",
      login: "/login/baylor-school",
    });
    expect(o!.logo).toMatch(/^\/org-logo\/baylor-school\?v=\d+$/);
    expect((await listOrgs(db.pool)).map((x) => x.slug)).toEqual(["thunder", "scenic-city", "baylor-school"]);

    const roles = await db.pool.query(
      "select role from org_roles where coach_id = '5550001' and org = 'baylor-school' order by role",
    );
    expect(roles.rows.map((r) => r.role)).toEqual(["Admin", "Director", "Owner"]);
    expect(await hasFeature(db.pool, "baylor-school", "hosting-available")).toBe(true);
    expect(await hasFeature(db.pool, "baylor-school", "practice")).toBe(false);
    expect((await db.pool.query("select feature from org_feature_requests")).rows).toEqual([{ feature: "practice" }]);
    expect((await userContexts(db.pool, jo)).find((c) => c.key === "org:baylor-school")).toEqual({
      key: "org:baylor-school",
      org: "baylor-school",
      label: "Owner",
      href: "/org/baylor-school",
    });
  });

  it("checks the name, picks, and logo on the server; names are unique; slugs don't clash", async () => {
    expect(await createOrganization(deps(), jo, { ...input, name: "=HYPERLINK()" }, null)).toMatchObject({ ok: false });
    expect(await createOrganization(deps(), jo, { ...input, kind: "Gang" }, null)).toMatchObject({ ok: false });
    expect(await createOrganization(deps(), jo, { ...input, features: ["alerts"] }, null)).toMatchObject({
      ok: false,
      message: "Choose at least one thing you need.",
    });
    expect(await createOrganization(deps(), jo, input, { bytes: new Uint8Array([1, 2, 3]), type: "image/png" })).toMatchObject({
      ok: false,
      message: /PNG, JPEG or WebP/,
    });
    expect(await createOrganization(deps(), jo, input, { bytes: new Uint8Array(600 * 1024), type: "image/png" })).toMatchObject({
      ok: false,
      message: /512 KB/,
    });
    expect(await createOrganization(deps(), jo, input, null)).toMatchObject({ ok: true, slug: "baylor-school" });
    expect(await createOrganization(deps(), jo, { ...input, name: "baylor school" }, null)).toMatchObject({
      ok: false,
      message: /already/,
    });
    expect(await createOrganization(deps(), jo, { ...input, name: "Baylor School!" }, null)).toMatchObject({ ok: false });
    expect(await createOrganization(deps(), jo, { ...input, name: "Baylor-School" }, null)).toMatchObject({
      ok: true,
      slug: "baylor-school-2",
    });
    expect((await orgInfo(db.pool, "baylor-school"))!.logo).toBeNull(); // a letter badge until a logo is added
  });

  it("logos: real type from the bytes; only the organization's Admins change it", async () => {
    expect(logoType(png)).toBe("image/png");
    expect(logoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(logoType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(logoType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(slugFor("St. Mary's & Friends")).toBe("st-mary-s-and-friends");

    await createOrganization(deps(), jo, input, null);
    const other = { ...jo, coachId: "5550002" };
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550002', 'Mark', 'Thomas', '4235550002')",
    );
    expect(await setOrgLogo(deps(), other, "baylor-school", { bytes: png, type: "image/png" })).toMatchObject({ ok: false });
    expect(await setOrgLogo(deps(), jo, "baylor-school", { bytes: png, type: "image/png" })).toEqual({ ok: true });
    expect((await orgInfo(db.pool, "baylor-school"))!.logo).toMatch(/^\/org-logo\//);
    // Color: Admins pick one of the colors.
    expect(await setOrgColor(deps(), other, "baylor-school", "#b91c1c")).toMatchObject({ ok: false });
    expect(await setOrgColor(deps(), jo, "baylor-school", "#123456")).toEqual({ ok: false, message: "Pick one of the colors." });
    expect(await setOrgColor(deps(), jo, "baylor-school", "#b91c1c")).toEqual({ ok: true });
    expect((await orgInfo(db.pool, "baylor-school"))!.color).toBe("#b91c1c");
  });

  it("hosting for a registered organization: its own gyms, ask Scenic City, then its game days are open courts there", async () => {
    await createOrganization(
      deps(),
      jo,
      { ...input, name: "East Ridge Parks & Rec", short: "East Ridge", features: ["hosting-available"] },
      null,
    );
    const org = "east-ridge-parks-and-rec";
    const sue = { ...jo, coachId: "5550003", firstName: "Sue" }; // Scenic City Admin
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550003', 'Sue', 'X', '4235550003')");
    await grant(db.pool, "5550003 scenic-city Director", "5550003 scenic-city Admin");
    // Thunder has a gym with the same name: fine, names are per organization; it never shows here.
    await db.pool.query("insert into gyms (name) values ('East Ridge MS')");

    expect(
      await addOrgGym(deps(), { ...jo, coachId: "5550003" }, org, { name: "Gym", short: "G", courts: ["Main"] }),
    ).toMatchObject({ ok: false });
    expect(await addOrgGym(deps(), jo, org, { name: "East Ridge MS", short: "ERMS", courts: ["Main", "Aux"] })).toMatchObject({
      ok: true,
    });
    expect(await addOrgGym(deps(), jo, org, { name: "=cmd", short: "C", courts: ["Main"] })).toMatchObject({ ok: false });
    expect(await addOrgGym(deps(), jo, org, { name: "Other", short: "erms", courts: ["Main"] })).toMatchObject({ ok: false }); // short name taken
    expect(await addOrgGym(deps(), jo, org, { name: "Other", short: "OTH", courts: ["Main", "main"] })).toMatchObject({
      ok: false,
    });
    const view = (await facilitiesView(deps(), jo, org))!;
    expect(view.gyms.map((g) => `${g.name} (${g.short}): ${g.courts.join(", ")}`)).toEqual(["East Ridge MS (ERMS): Aux, Main"]);
    expect(view.uses).toEqual([]); // nothing until a league approves
    expect(view.partnerNote).toMatch(/approves East Ridge as a hosting site/);
    // Event Management gives In-House Games.
    await db.pool.query("insert into org_features (org, feature, source) values ($1, 'events', 'setup')", [org]);
    expect((await availableUses(db.pool, org)).uses).toEqual(["in-house"]);
    await db.pool.query("delete from org_features where org = $1 and feature = 'events'", [org]);
    const gym = view.gyms[0].id;

    // Hosting Sites Available is enough to ask; Scenic City approves.
    expect((await hostingOffers(deps(), jo, org))!.map((o) => o.org)).toEqual(["scenic-city"]);
    expect(await requestHosting(deps(), jo, org, "scenic-city")).toEqual({ ok: true });
    const [req] = (await hostingRequests(deps(), sue, "scenic-city"))!;
    expect(req.name).toBe("East Ridge Parks & Rec");
    await decideHosting(deps(), sue, req.id, true);
    expect((await availableUses(db.pool, org)).uses).toEqual(["partner"]);

    const day = await db.pool.query<{ id: string }>(
      "insert into game_days (day, created_by) values ('2026-12-05', 'x') returning id::text",
    );
    // Scenic City's game days show on East Ridge's calendar once it's approved.
    expect((await facilitiesView(deps(), jo, org))!.gameDays).toMatchObject({ "2026-12-05": "Scenic City" });
    expect(
      await setAvailability(deps(), jo, { org, gymId: gym, days: ["2026-12-05"], use: "partner", defaults: true }),
    ).toMatchObject({ ok: true });
    expect(
      await setAvailability(deps(), jo, { org, gymId: gym, days: ["2026-12-05"], use: "practice", defaults: true }),
    ).toMatchObject({ ok: false });
    expect(await openCourtsByDay(deps(), sue)).toEqual({ [day.rows[0].id]: 1 });
    const partnerId = (await db.pool.query<{ id: string }>("select id::text from partners where org_slug = $1", [org])).rows[0]
      .id;
    expect((await partnerHours(deps(), sue, partnerId))!.courts).toEqual([{ id: gym, gym: "East Ridge MS", name: "Whole gym" }]);

    expect(await removeOrgGym(deps(), jo, org, gym)).toEqual({ ok: true });
    expect(await openCourtsByDay(deps(), sue)).toEqual({});
  });
});
