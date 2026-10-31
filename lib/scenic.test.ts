import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { approveRequest, cleanPartnerName, denyRequest, joinStatus, listScenicPeople, partnerOptions, requestJoin, setScenicRoles } from "./scenic";
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
let hiddenId = ""; // not approved yet

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
    [thunderId, hiddenId] = p.rows.map((r) => r.id);
  });

  const roles = async (coachId: string) =>
    (await db.pool.query<{ role: string }>("select role from org_roles where coach_id = $1 and org = 'scenic-city' order by role", [coachId])).rows.map(
      (r) => r.role,
    );
  const partners = async () =>
    (await db.pool.query("select name, approved from partners order by name")).rows.map((p) => `${p.name}${p.approved ? "" : " (new)"}`);

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

  it("Solo request: pending until a Director approves it", async () => {
    expect(await joinStatus(deps(), sam)).toBe("none");
    expect(await requestJoin(deps(), sam, { wants: "Solo" })).toEqual({ ok: true });
    expect(await joinStatus(deps(), sam)).toBe("pending");
    expect(await roles(sam.coachId)).toEqual(["Request"]);
    const list = await listScenicPeople(deps(), dee);
    expect(list?.requests).toMatchObject([{ coachId: "5550002", wants: "Solo", partner: null }]);

    expect(await approveRequest(deps(), dee, sam.coachId, "Solo")).toEqual({ ok: true });
    expect(await roles(sam.coachId)).toEqual(["Solo"]);
    expect(await joinStatus(deps(), sam)).toBe("member");
    const after = await listScenicPeople(deps(), dee);
    expect(after?.requests).toEqual([]);
    expect(after?.members.map((m) => `${m.firstName}:${m.roles.join(",")}:${m.grantedBy}`)).toEqual(["Dee:Director:test", "Sam:Solo:Dee X"]);
  });

  it("Partner with a new school: approving approves the school and makes them its contact", async () => {
    const r = await requestJoin(deps(), pat, {
      wants: "Partner",
      newPartner: { name: "Baylor School", kind: "School", hostsGames: true, registersTeams: false },
    });
    expect(r).toEqual({ ok: true });
    expect(await partners()).toEqual(["Baylor School (new)", "Hidden Prep (new)", "Thunder Basketball"]);
    expect((await listScenicPeople(deps(), dee))?.requests[0].partner).toMatchObject({ name: "Baylor School", kind: "School", hostsGames: true, approved: false });

    await approveRequest(deps(), dee, pat.coachId, "Partner");
    expect(await partners()).toEqual(["Baylor School", "Hidden Prep (new)", "Thunder Basketball"]);
    expect((await listScenicPeople(deps(), dee))?.members.find((m) => m.coachId === pat.coachId)).toMatchObject({
      roles: ["Partner"],
      partners: ["Baylor School"],
    });
  });

  it("a new name that matches an existing partner uses it; an unapproved partner can't be picked by id", async () => {
    await requestJoin(deps(), pat, { wants: "Partner", newPartner: { name: "thunder basketball", kind: "School", hostsGames: true, registersTeams: true } });
    expect(await partners()).toEqual(["Hidden Prep (new)", "Thunder Basketball"]);
    expect(await requestJoin(deps(), sam, { wants: "Partner", partnerId: hiddenId })).toMatchObject({ ok: false, message: /Pick your school/ });
    expect(await requestJoin(deps(), sam, { wants: "Partner", partnerId: thunderId })).toEqual({ ok: true });
  });

  it("checks the request", async () => {
    expect(await requestJoin(deps(), pat, { wants: "Director" })).toMatchObject({ ok: false, message: "Choose Partner or Solo." });
    const np = { name: "Baylor", kind: "School", hostsGames: false, registersTeams: false };
    expect(await requestJoin(deps(), pat, { wants: "Partner", newPartner: np })).toMatchObject({ ok: false, message: /Hosting games/ });
    expect(await requestJoin(deps(), pat, { wants: "Partner", newPartner: { ...np, hostsGames: true, kind: "Club" } })).toMatchObject({ ok: false });
    expect(await requestJoin(deps(), dee, { wants: "Solo" })).toMatchObject({ ok: false, message: "You're already part of Scenic City." });
    expect(await roles(pat.coachId)).toEqual([]);
  });

  it("deny: no role, and a new partner nobody else asked for goes away", async () => {
    await requestJoin(deps(), pat, { wants: "Partner", newPartner: { name: "Baylor School", kind: "School", hostsGames: true, registersTeams: true } });
    expect(await denyRequest(deps(), dee, pat.coachId)).toEqual({ ok: true });
    expect(await roles(pat.coachId)).toEqual([]);
    expect(await partners()).toEqual(["Hidden Prep (new)", "Thunder Basketball"]);
    expect(await joinStatus(deps(), pat)).toBe("none");
  });

  it("edit roles: Director is left alone (Admins set it); dropping Partner takes them off their partners", async () => {
    await requestJoin(deps(), pat, { wants: "Partner", partnerId: thunderId });
    await approveRequest(deps(), dee, pat.coachId, "Partner");
    expect(await setScenicRoles(deps(), dee, dee.coachId, ["Coach"])).toEqual({ ok: true });
    expect(await roles(dee.coachId)).toEqual(["Admin", "Coach", "Director"]); // Admin and Director are left alone
    expect(await approveRequest(deps(), dee, pat.coachId, "Director")).toMatchObject({ ok: false });
    expect(await setScenicRoles(deps(), dee, pat.coachId, ["Coach", "Solo", "Bogus"])).toEqual({ ok: true });
    expect(await roles(pat.coachId)).toEqual(["Coach", "Solo"]);
    expect((await db.pool.query("select count(*)::int n from partner_contacts")).rows[0].n).toBe(0);
  });

  it("only Scenic City Admins manage requests and roles (a Director with areas isn't enough)", async () => {
    await requestJoin(deps(), sam, { wants: "Solo" });
    await grant(db.pool, "5550001 thunder Director", "5550001 scenic-city Partner", "5550001 scenic-city Director");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('5550001', 'scenic-city', 'facilities', 'test')");
    expect(await listScenicPeople(deps(), pat)).toBeNull();
    expect(await approveRequest(deps(), pat, sam.coachId, "Solo")).toMatchObject({ ok: false });
    expect(await denyRequest(deps(), pat, sam.coachId)).toMatchObject({ ok: false });
    expect(await setScenicRoles(deps(), pat, sam.coachId, ["Director"])).toMatchObject({ ok: false });
    expect(await approveRequest(deps(), pat, sam.coachId, "Solo")).toEqual({ ok: false, message: "Only a Scenic City Admin can do that." });
    expect(await roles(sam.coachId)).toEqual(["Request"]);
  });
});
