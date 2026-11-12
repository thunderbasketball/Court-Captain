import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { gymsWithoutOfficials, approvedGroups, decideOfficiating, gymOfficials, officiatesGames, officiatingOffers, officiatingRequests, requestOfficiating, setGymOfficials } from "./officiating";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({ coachId, firstName, lastName: "X", isDirector: false }) as SessionUser;
const ORG = "sc-officials"; // an Officials Group
const otto = person("5550008", "Otto"); // its Director of Officials
const sue = person("5550009", "Sue"); // Scenic City Director of Scheduling
const dan = person("5550007", "Dan"); // Scenic City Director of Facilities only

describe("CourtSync officiating: an Officials Group asks a league, the league decides", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-11T17:00:00Z") });
  beforeEach(async () => {
    await db.reset();
    await db.pool.query(`delete from org_role_types where org = '${ORG}'`);
    await db.pool.query(`delete from organizations where slug = '${ORG}'`);
    await db.pool.query(`insert into organizations (slug, name, short_name, kind) values ('${ORG}', 'Scenic City Officials', 'SCO', 'Officials')`);
    await db.pool.query(`insert into org_role_types (org, role) select '${ORG}', r from unnest(array['Request', 'Coach', 'Director', 'Admin', 'Owner']) r`);
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('5550008', 'Otto', 'X', '4235550008'), ('5550009', 'Sue', 'X', '4235550009'), ('5550007', 'Dan', 'X', '4235550007')`,
    );
    await grant(db.pool, `5550008 ${ORG} Director`, "5550009 scenic-city Director", "5550007 scenic-city Director");
    await db.pool.query(
      `insert into director_areas (coach_id, org, area, granted_by) values
         ('5550008', '${ORG}', 'officials', 't'), ('5550009', 'scenic-city', 'scheduling', 't'), ('5550007', 'scenic-city', 'facilities', 't')`,
    );
    await db.pool.query(
      `delete from org_features where org = 'scenic-city';
       insert into org_features (org, feature, source, turned_on_by) values
         ('${ORG}', 'court-officials', 'setup', 't'), ('scenic-city', 'court-teams', 'setup', 't'), ('scenic-city', 'court-sync', 'setup', 't')`,
    );
  });

  it("needs CourtSync on; lists leagues; asks once (again after a decline); the league's Scheduling or Programs people decide", async () => {
    expect(await officiatesGames(db.pool, ORG)).toBe(false);
    expect(await requestOfficiating(deps(), otto, ORG, "scenic-city")).toMatchObject({ ok: false, message: expect.stringContaining("CourtSync") });
    await db.pool.query(`insert into org_features (org, feature, source, turned_on_by) values ('${ORG}', 'court-sync', 'setup', 't')`);
    expect(await officiatingOffers(deps(), otto, ORG)).toEqual([
      { org: "scenic-city", name: expect.any(String), status: "none", requestedBy: null, decidedBy: null },
    ]); // Thunder isn't a league
    expect(await requestOfficiating(deps(), sue, ORG, "scenic-city")).toMatchObject({ ok: false }); // not theirs to ask
    expect(await requestOfficiating(deps(), otto, ORG, "thunder")).toMatchObject({ ok: false }); // not a league
    expect(await requestOfficiating(deps(), otto, ORG, "scenic-city")).toEqual({ ok: true });
    expect(await requestOfficiating(deps(), otto, ORG, "scenic-city")).toMatchObject({ ok: false, message: expect.stringContaining("already") });

    expect(await officiatingRequests(deps(), dan, "scenic-city")).toBeNull(); // Facilities only
    const [req] = (await officiatingRequests(deps(), sue, "scenic-city"))!;
    expect(req).toMatchObject({ officialsOrg: ORG, name: "Scenic City Officials", status: "pending", requestedBy: "Otto X" });
    expect(await decideOfficiating(deps(), dan, req.id, true)).toMatchObject({ ok: false });
    expect(await decideOfficiating(deps(), sue, req.id, false)).toEqual({ ok: true });
    expect(await decideOfficiating(deps(), sue, req.id, true)).toMatchObject({ ok: false, message: expect.stringContaining("already") });
    expect((await officiatingOffers(deps(), otto, ORG))![0]).toMatchObject({ status: "declined", decidedBy: "Sue X" });
    expect(await requestOfficiating(deps(), otto, ORG, "scenic-city")).toEqual({ ok: true }); // ask again
    expect(await decideOfficiating(deps(), sue, req.id, true)).toEqual({ ok: true });
    expect((await officiatingRequests(deps(), sue, "scenic-city"))![0]).toMatchObject({ status: "approved", decidedBy: "Sue X" });
  });

  it("a league picks an approved officials group for each hosting gym; clears it; only its Scheduling, Programs or Facilities people", async () => {
    await db.pool.query(`insert into org_features (org, feature, source, turned_on_by) values ('${ORG}', 'court-sync', 'setup', 't')`);
    const gym = (await db.pool.query<{ id: string }>("insert into gyms (name) values ('Action Church') returning id::text")).rows[0].id;
    await db.pool.query(
      `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values ('Thunder', 'Organization', true, false, true, 'x', 'thunder');
       insert into org_partnerships (host_org, for_org, status, requested_by) values ('thunder', 'scenic-city', 'approved', 'x')`,
    );
    const key = `o${gym}`;
    expect(await gymsWithoutOfficials(db.pool, "scenic-city")).toBe(1); // the warning
    expect(await setGymOfficials(deps(), dan, "scenic-city", key, ORG)).toMatchObject({ ok: false, message: expect.stringContaining("approved") });
    await requestOfficiating(deps(), otto, ORG, "scenic-city");
    const [req] = (await officiatingRequests(deps(), sue, "scenic-city"))!;
    await decideOfficiating(deps(), sue, req.id, true);
    expect(await approvedGroups(db.pool, "scenic-city")).toEqual([{ org: ORG, name: "Scenic City Officials" }]);
    expect(await setGymOfficials(deps(), otto, "scenic-city", key, ORG)).toMatchObject({ ok: false }); // the group can't pick
    expect(await setGymOfficials(deps(), dan, "scenic-city", "o999999", ORG)).toMatchObject({ ok: false }); // no such gym
    expect(await setGymOfficials(deps(), dan, "scenic-city", key, ORG)).toEqual({ ok: true }); // Facilities can
    expect((await gymOfficials(db.pool, "scenic-city")).get(key)).toEqual({ org: ORG, name: "Scenic City Officials", setBy: "Dan X" });
    expect(await gymsWithoutOfficials(db.pool, "scenic-city")).toBe(0);
    expect(await setGymOfficials(deps(), sue, "scenic-city", key, null)).toEqual({ ok: true });
    expect((await gymOfficials(db.pool, "scenic-city")).size).toBe(0);
    expect(await gymsWithoutOfficials(db.pool, "scenic-city")).toBe(1);
  });
});
