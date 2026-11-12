import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addOfficial, importOfficials, listOfficials, managesOfficials, previewOfficialImport, removeOfficial, setOfficialLevel, canOfficiate, acceptsRecruits, applyToOfficiate, recruitingOn, setAcceptsRecruits } from "./officials";
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

  it("Recruits can't be scheduled to officiate games", () => {
    expect([canOfficiate("Certified"), canOfficiate("Student"), canOfficiate(null), canOfficiate("Recruit")]).toEqual([true, true, true, false]);
  });

  it("imports: preview marks New, Already an official, Listed twice and Fix; adds the new ones (new logins with their email)", async () => {
    await addOfficial(deps(), otto, ORG, { first: "Rita", last: "Ref", cell: "4235550006" });
    const text =
      "First,Last,Cell,Email,Level\nRita,Ref,423-555-0006,,\nSue,X,4235550009,,student\nNew,Person,4235550111,new@example.com,Certified\nDup,Person,(423) 555-0111,,\nBad,,123,,";
    expect(await previewOfficialImport(deps(), dan, ORG, text)).toMatchObject({ ok: false });
    const p = await previewOfficialImport(deps(), otto, ORG, text);
    if (!p.ok) throw new Error(p.message);
    expect(p.rows.map((r) => [r.first, r.status, r.errors])).toEqual([
      ["Rita", "exists", []],
      ["Sue", "new", []],
      ["New", "new", []],
      ["Dup", "error", ["Listed twice"]],
      ["Bad", "error", ["Name: a first and last name (letters only)", 'Cell "123": 10 digits']],
    ]);
    expect(await importOfficials(deps(), dan, ORG, text)).toMatchObject({ ok: false });
    expect(await importOfficials(deps(), otto, ORG, text)).toEqual({ ok: true, added: 2, newLogins: 1, updated: 0, skipped: 3 });
    expect((await listOfficials(deps(), otto, ORG))!.map((o) => o.name).sort()).toEqual(["New Person", "Rita Ref", "Sue X"]);
    expect((await db.pool.query("select email from users where cell = '4235550111'")).rows[0].email).toBe("new@example.com");
    expect((await listOfficials(deps(), otto, ORG))!.map((o) => [o.name, o.level])).toEqual([
      ["New Person", "Certified"],
      ["Rita Ref", null],
      ["Sue X", "Student"],
    ]);
    expect(await importOfficials(deps(), otto, ORG, text)).toEqual({ ok: true, added: 0, newLogins: 0, updated: 0, skipped: 5 }); // again: nothing new
    // A new level for one already on the list: Update.
    const up = "Rita,Ref,4235550006,,Recruit";
    expect((await previewOfficialImport(deps(), otto, ORG, up)) as { rows: { status: string }[] }).toMatchObject({ rows: [{ status: "update" }] });
    expect(await importOfficials(deps(), otto, ORG, up)).toEqual({ ok: true, added: 0, newLogins: 0, updated: 1, skipped: 0 });
    // Changed on the row; blank clears it; only those who keep officials.
    expect((await listOfficials(deps(), otto, ORG))!.find((o) => o.id === "5550006")?.level).toBe("Recruit");
    expect(await setOfficialLevel(deps(), dan, ORG, "5550006", "Certified")).toMatchObject({ ok: false });
    expect(await setOfficialLevel(deps(), otto, ORG, "5550006", "Varsity")).toMatchObject({ ok: false });
    expect(await setOfficialLevel(deps(), otto, ORG, "5550006", " experience ")).toEqual({ ok: true });
    expect((await listOfficials(deps(), otto, ORG))!.find((o) => o.id === "5550006")?.level).toBe("Experienced");
    expect(await setOfficialLevel(deps(), otto, ORG, "5550006", "")).toEqual({ ok: true });
    expect((await listOfficials(deps(), otto, ORG))!.find((o) => o.id === "5550006")?.level).toBeNull();
    // Added one at a time with email and level.
    expect(await addOfficial(deps(), otto, ORG, { first: "Ann", last: "Lee", cell: "4235550222", email: "ann@example.com", level: "Student" })).toMatchObject({ ok: true });
    expect((await listOfficials(deps(), otto, ORG))!.find((o) => o.id === "5550222")).toMatchObject({ email: "ann@example.com", level: "Student" });
    expect(await previewOfficialImport(deps(), otto, ORG, "  ")).toMatchObject({ ok: false });
  });

  it("Accept recruits: Apply to officiate on the group's and its leagues' login pages; applicants join as Recruits", async () => {
    const form = { first: "pat", last: "Jones", cell: "(423) 555-0301", email: "", experience: "  3 years   middle school  ", website: "" };
    expect(await applyToOfficiate(deps(), ORG, form)).toMatchObject({ ok: false }); // not taking applications yet
    expect(await recruitingOn(db.pool, "scenic-city")).toEqual([]);
    expect(await setAcceptsRecruits(deps(), dan, ORG, true)).toMatchObject({ ok: false });
    expect(await setAcceptsRecruits(deps(), otto, ORG, true)).toEqual({ ok: true });
    expect(await acceptsRecruits(db.pool, ORG)).toBe(true);
    expect(await recruitingOn(db.pool, ORG)).toEqual([{ org: ORG, name: "Scenic City Officials" }]);
    expect(await recruitingOn(db.pool, "scenic-city")).toEqual([]); // not approved for Scenic City yet
    await db.pool.query(
      `insert into officiating_partnerships (officials_org, for_org, status, requested_by) values ('${ORG}', 'scenic-city', 'approved', 'x')`,
    );
    expect(await recruitingOn(db.pool, "scenic-city")).toEqual([{ org: ORG, name: "Scenic City Officials" }]);
    expect(await recruitingOn(db.pool, "thunder")).toEqual([]);

    expect(await applyToOfficiate(deps(), ORG, { ...form, website: "http://spam" })).toMatchObject({ ok: false }); // a bot
    expect(await applyToOfficiate(deps(), ORG, { ...form, cell: "123" })).toMatchObject({ ok: false });
    expect(await applyToOfficiate(deps(), ORG, { ...form, email: "nope" })).toMatchObject({ ok: false });
    expect(await applyToOfficiate(deps(), ORG, form)).toEqual({ ok: true, name: "pat", already: false });
    expect(await applyToOfficiate(deps(), ORG, form)).toEqual({ ok: true, name: "pat", already: true });
    const o = (await listOfficials(deps(), otto, ORG))!.find((x) => x.id === "5550301")!;
    expect(o).toMatchObject({ level: "Recruit", addedBy: "Applied online", application: "3 years middle school" });
    expect(o.appliedAt).toBeInstanceOf(Date);
    await setAcceptsRecruits(deps(), otto, ORG, false);
    expect(await applyToOfficiate(deps(), ORG, { ...form, cell: "4235550302" })).toMatchObject({ ok: false });
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
