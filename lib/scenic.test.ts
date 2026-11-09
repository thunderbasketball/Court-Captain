import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import {
  approveRequest,
  cleanPartnerName,
  denyRequest,
  joinStatus,
  listScenicPeople,
  partnerOptions,
  requestJoin,
  setScenicRoles,
} from "./scenic";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const dee = person("9913694", "Dee"); // Scenic City Admin
const pat = person("5550001", "Pat");
const sam = person("5550002", "Sam");
let thunderId = ""; // approved partner

describe("Scenic City joining and users", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => db.drop());
  const now = new Date("2026-10-30T12:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('9913694', 'Dee', 'X', '4239913694'), ('5550001', 'Pat', 'X', '4235550001'), ('5550002', 'Sam', 'X', '4235550002')`,
    );
    await grant(db.pool, "9913694 scenic-city Director", "9913694 scenic-city Admin");
    const p = await db.pool.query<{ id: string }>(
      `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values
         ('Thunder Basketball', 'Organization', true, true, true, 'setup'),
         ('Hidden Prep', 'School', true, false, false, 'x')
       returning id::text`,
    );
    [thunderId] = p.rows.map((r) => r.id);
  });

  const roles = async (coachId: string) =>
    (
      await db.pool.query<{ role: string }>(
        "select role from org_roles where coach_id = $1 and org = 'scenic-city' order by role",
        [coachId],
      )
    ).rows.map((r) => r.role);
  const partners = async () =>
    (await db.pool.query("select name, approved from partners order by name")).rows.map(
      (p) => `${p.name}${p.approved ? "" : " (new)"}`,
    );

  it("partner names: letters, numbers and simple punctuation; never a formula", () => {
    expect(cleanPartnerName("  Baylor   School ")).toBe("Baylor School");
    expect(cleanPartnerName("St. Mary's (K-8) & Co")).toBe("St. Mary's (K-8) & Co");
    expect(cleanPartnerName("=HYPERLINK()")).toBeNull();
    expect(cleanPartnerName("-x")).toBeNull();
    expect(cleanPartnerName("A")).toBeNull();
  });

  it("only approved partners are offered", async () => {
    expect((await partnerOptions(deps())).map((p) => p.name)).toEqual(["Thunder Basketball"]);
  });

  // Leftover join requests from before joining by request was retired.
  const oldRequest = async (coachId: string) => {
    await db.pool.query("insert into access_requests (coach_id, org, wants, partner_id, created_at) values ($1, 'scenic-city', 'Solo', null, now())", [
      coachId,
    ]);
    await grant(db.pool, `${coachId} scenic-city Request`);
  };

  it("joining by request is retired (Solo and Partner); a leftover request is approved as Coach, never Solo", async () => {
    expect(await joinStatus(deps(), sam)).toBe("none");
    expect(await requestJoin(deps(), sam, { wants: "Solo" })).toMatchObject({ ok: false, message: /One team/ });
    expect(await requestJoin(deps(), pat, { wants: "Partner", partnerId: thunderId })).toMatchObject({
      ok: false,
      message: /their own organization on CourtCaptain/,
    });
    expect(await roles(sam.coachId)).toEqual([]);

    await oldRequest(sam.coachId);
    expect(await joinStatus(deps(), sam)).toBe("pending");
    expect((await listScenicPeople(deps(), dee))?.requests).toMatchObject([{ coachId: "5550002", wants: "Solo", partner: null }]);
    expect(await approveRequest(deps(), dee, sam.coachId, "Solo")).toMatchObject({ ok: false, message: /One team/ });
    expect(await approveRequest(deps(), dee, sam.coachId, "Partner")).toMatchObject({ ok: false });
    expect(await approveRequest(deps(), dee, sam.coachId, "Coach")).toEqual({ ok: true });
    expect(await roles(sam.coachId)).toEqual(["Coach"]);
    expect(await joinStatus(deps(), sam)).toBe("member");
    expect((await listScenicPeople(deps(), dee))?.requests).toEqual([]);
  });

  it("deny: the request goes away with no role", async () => {
    await oldRequest(pat.coachId);
    expect(await denyRequest(deps(), dee, pat.coachId)).toEqual({ ok: true });
    expect(await roles(pat.coachId)).toEqual([]);
    expect(await partners()).toEqual(["Hidden Prep (new)", "Thunder Basketball"]);
    expect(await joinStatus(deps(), pat)).toBe("none");
  });

  it("edit roles: Director is left alone (Admins set it); Partner and Solo are only ever taken away", async () => {
    await grant(db.pool, "5550001 scenic-city Partner"); // left over from before it was retired
    expect(await setScenicRoles(deps(), dee, dee.coachId, ["Coach"])).toEqual({ ok: true });
    expect(await roles(dee.coachId)).toEqual(["Admin", "Coach", "Director"]); // Admin and Director are left alone
    await grant(db.pool, "5550001 scenic-city Solo"); // left over from before it was retired
    expect(await setScenicRoles(deps(), dee, pat.coachId, ["Coach", "Solo", "Partner", "Bogus"])).toEqual({ ok: true });
    expect(await roles(pat.coachId)).toEqual(["Coach"]); // Solo and Partner are only ever taken away
  });

  it("only Scenic City Admins manage requests and roles (a Director with areas isn't enough)", async () => {
    await oldRequest(sam.coachId);
    await grant(db.pool, "5550001 thunder Director", "5550001 scenic-city Partner", "5550001 scenic-city Director");
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('5550001', 'scenic-city', 'facilities', 'test')",
    );
    expect(await listScenicPeople(deps(), pat)).toBeNull();
    expect(await approveRequest(deps(), pat, sam.coachId, "Coach")).toMatchObject({ ok: false });
    expect(await denyRequest(deps(), pat, sam.coachId)).toMatchObject({ ok: false });
    expect(await setScenicRoles(deps(), pat, sam.coachId, ["Director"])).toMatchObject({ ok: false });
    expect(await approveRequest(deps(), pat, sam.coachId, "Coach")).toEqual({
      ok: false,
      message: "Only a Scenic City Admin can do that.",
    });
    expect(await roles(sam.coachId)).toEqual(["Request"]);
  });
});
