import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addOfficial, listOfficials, managesOfficials, removeOfficial } from "./officials";
import { orgFeatureKeys } from "./features";
import { assignerCount, setAssigner } from "./org-admin";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({ coachId, firstName, lastName: "X", isDirector: false }) as SessionUser;
const ORG = "sc-officials"; // an Officials Group
const sue = person("5550009", "Sue"); // its Admin
const otto = person("5550008", "Otto"); // its Director of Officials
const dan = person("5550007", "Dan"); // a Director there without the Officials area

describe("CourtSync officials", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-11T17:00:00Z") });
  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('5550009', 'Sue', 'X', '4235550009'), ('5550008', 'Otto', 'X', '4235550008'), ('5550007', 'Dan', 'X', '4235550007'),
         ('5550006', 'Rita', 'Ref', '4235550006')`,
    );
    await db.pool.query(`delete from org_role_types where org = '${ORG}'`);
    await db.pool.query(`delete from organizations where slug = '${ORG}'`);
    await db.pool.query(`insert into organizations (slug, name, short_name, kind) values ('${ORG}', 'Scenic City Officials', 'SC Officials', 'Officials')`);
    await db.pool.query(`insert into org_role_types (org, role) select '${ORG}', r from unnest(array['Request', 'Coach', 'Director', 'Admin', 'Owner']) r`);
    await grant(db.pool, `5550009 ${ORG} Admin`, `5550008 ${ORG} Director`, `5550007 ${ORG} Director`);
    await db.pool.query(
      `insert into director_areas (coach_id, org, area, granted_by) values ('5550008', '${ORG}', 'officials', 't'), ('5550007', '${ORG}', 'support', 't')`,
    );
    await db.pool.query(`insert into org_features (org, feature, source, turned_on_by) values ('${ORG}', 'court-officials', 'setup', 't'), ('${ORG}', 'court-sync', 'setup', 't')`);
  });

  it("an Officials Group keeps them (CourtOfficials), its Admins and Directors of Officials; no teams or gyms there", async () => {
    expect(await managesOfficials(db.pool, sue, ORG)).toBe(true);
    expect(await managesOfficials(db.pool, otto, ORG)).toBe(true);
    expect(await managesOfficials(db.pool, dan, ORG)).toBe(false);
    expect(await listOfficials(deps(), dan, ORG)).toBeNull();
    expect([...(await orgFeatureKeys(db.pool, ORG))].sort()).toEqual(["alerts", "court-officials", "court-sync"]);
    expect(await managesOfficials(db.pool, sue, "scenic-city")).toBe(false); // a league doesn't keep officials itself
    await db.pool.query(`delete from org_features where org = '${ORG}' and feature = 'court-officials'`);
    expect(await managesOfficials(db.pool, sue, ORG)).toBe(false);
  });

  it("adds by cell (the person with it, or a new login), lists by last name, and removes", async () => {
    expect(await addOfficial(deps(), dan, ORG, { first: "Rita", last: "Ref", cell: "4235550006" })).toMatchObject({ ok: false });
    expect(await addOfficial(deps(), otto, ORG, { first: "Rita", last: "Ref", cell: "(423) 555-0006" })).toEqual({
      ok: true,
      name: "Rita Ref",
      newLogin: false,
    });
    expect(await addOfficial(deps(), otto, ORG, { first: "Rita", last: "Ref", cell: "4235550006" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("already"),
    });
    expect(await addOfficial(deps(), otto, ORG, { first: "=cmd", last: "Ref", cell: "4235550005" })).toMatchObject({ ok: false });
    expect(await addOfficial(deps(), otto, ORG, { first: "Al", last: "Abbot", cell: "123" })).toMatchObject({ ok: false });
    expect(await addOfficial(deps(), sue, ORG, { first: "Al", last: "Abbot", cell: "4235550005" })).toEqual({
      ok: true,
      name: "Al Abbot",
      newLogin: true,
    });
    expect((await listOfficials(deps(), otto, ORG))!.map((o) => [o.name, o.addedBy])).toEqual([
      ["Al Abbot", "Sue X"],
      ["Rita Ref", "Otto X"],
    ]);
    expect(await removeOfficial(deps(), dan, ORG, "5550006")).toMatchObject({ ok: false });
    expect(await removeOfficial(deps(), otto, ORG, "5550006")).toEqual({ ok: true });
    expect(await removeOfficial(deps(), otto, ORG, "5550006")).toMatchObject({ ok: false });
    expect((await listOfficials(deps(), otto, ORG))!.map((o) => o.name)).toEqual(["Al Abbot"]);
    expect((await db.pool.query("select 1 from users where coach_id = '5550006'")).rowCount).toBe(1); // their login stays
  });

  it("needs at least one Assigner: counts them; Admins make an Admin or a Director one, or not", async () => {
    expect(await assignerCount(db.pool, ORG)).toBe(1); // Otto
    expect(await assignerCount(db.pool, "scenic-city")).toBeNull(); // no CourtOfficials: no rule
    await db.pool.query(`delete from director_areas where org = '${ORG}' and area = 'officials'`);
    expect(await assignerCount(db.pool, ORG)).toBe(0); // the warning shows
    expect(await setAssigner(deps(), otto, ORG, "5550009", true)).toMatchObject({ ok: false }); // only Admins
    expect(await setAssigner(deps(), sue, ORG, "5550009", true)).toEqual({ ok: true }); // Sue (Admin) herself
    expect(await assignerCount(db.pool, ORG)).toBe(1);
    expect(await managesOfficials(db.pool, sue, ORG)).toBe(true);
    // Rita, a new Director just for assigning; taking it away leaves her no areas, so no Director role.
    expect(await setAssigner(deps(), sue, ORG, "5550006", true)).toEqual({ ok: true });
    expect(await managesOfficials(db.pool, person("5550006", "Rita"), ORG)).toBe(true);
    expect(await assignerCount(db.pool, ORG)).toBe(2);
    expect(await setAssigner(deps(), sue, ORG, "5550006", false)).toEqual({ ok: true });
    const r = await db.pool.query(`select has_role('5550006', '${ORG}', 'Director') as d`);
    expect(r.rows[0].d).toBe(false);
    expect(await setAssigner(deps(), sue, ORG, "5550009", false)).toEqual({ ok: true });
    expect(await assignerCount(db.pool, ORG)).toBe(0);
    expect(await setAssigner(deps(), sue, "scenic-city", "5550009", true)).toMatchObject({ ok: false });
  });
});
