import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NO_FEATURE } from "./features";
import { createTestDb } from "./testing/db";
import { addOwnPractice, canChangeOwnPractices, cleanLocation, ownPracticeLocations, removeOwnPractice, upcomingOwnPractices } from "./team-practices";

describe("a team's own practices", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  let now = new Date("2026-11-10T17:00:00Z"); // Tue Nov 10, noon Eastern
  const deps = () => ({ pool: db.pool, now: () => now });
  const person = (coachId: string, extra: object = {}) =>
    ({ coachId, firstName: "P", lastName: coachId, isDirector: false, thunderAreas: [], ...extra }) as never;
  const coach = person("5550001");
  const parent = person("5550002");
  const director = person("5550003", { isDirector: true, thunderAreas: ["practices"] });
  let thunder = "";
  let er = "";

  beforeEach(async () => {
    await db.reset();
    now = new Date("2026-11-10T17:00:00Z");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('5550001', 'P', '5550001', '4235550001'), ('5550002', 'P', '5550002', '4235550002'), ('5550004', 'P', '5550004', '4235550004')`,
    );
    thunder = (
      await db.pool.query<{ id: string }>(
        "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query(
      "insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x'), ($1, '5550002', 'TeamParent', 'x')",
      [thunder],
    );
    await db.pool.query("delete from org_role_types where org = 'east-ridge'");
    await db.pool.query("delete from organizations where slug = 'east-ridge'");
    await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('east-ridge', 'East Ridge', 'ER', 'Organization')");
    await db.pool.query("insert into org_features (org, feature, source) values ('east-ridge', 'court-practice', 'setup') on conflict do nothing");
    er = (
      await db.pool.query<{ id: string }>(
        "insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('east-ridge', '5B Ace', 'Boys', 5, 5, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550004', 'HeadCoach', 'x')", [er]);
  });

  const mon = { location: "Masters Gym", date: "2026-11-16", time: "18:00", minutes: 90 };

  it("the team's coaches and the Directors add them; a Team Parent or another team's coach can't", async () => {
    const T = { org: "thunder", teamId: thunder };
    expect(await canChangeOwnPractices(db.pool, coach, T)).toBe(true);
    expect(await canChangeOwnPractices(db.pool, director, T)).toBe(true);
    expect(await canChangeOwnPractices(db.pool, parent, T)).toBe(false);
    expect(await canChangeOwnPractices(db.pool, person("5550004"), T)).toBe(false);
    expect(await addOwnPractice(deps(), parent, T, mon)).toMatchObject({ ok: false });
    // Another organization's team: its coach, not Thunder's.
    const E = { org: "east-ridge", teamId: er };
    expect(await canChangeOwnPractices(db.pool, person("5550004"), E)).toBe(true);
    expect(await canChangeOwnPractices(db.pool, coach, E)).toBe(false);
    expect(await canChangeOwnPractices(db.pool, person("5550004"), { org: "thunder", teamId: er })).toBe(false);
    // Part of CourtFacility: without it, nothing is listed, added or removed.
    expect(await addOwnPractice(deps(), person("5550004"), E, mon)).toMatchObject({ ok: true });
    await db.pool.query("delete from org_features where org = 'east-ridge' and feature = 'court-practice'");
    expect(await canChangeOwnPractices(db.pool, person("5550004"), E)).toBe(false);
    expect(await upcomingOwnPractices(deps(), E)).toEqual([]);
    expect(await addOwnPractice(deps(), person("5550004"), E, { ...mon, date: "2026-11-17" })).toMatchObject({ ok: false, message: NO_FEATURE });
  });

  it("one practice, any length, no limits; times are Eastern", async () => {
    const T = { org: "thunder", teamId: thunder };
    const r = await addOwnPractice(deps(), coach, T, mon);
    expect(r).toMatchObject({ ok: true, skipped: [] });
    // Three more the same week: no booking limit on the team's own places.
    for (const date of ["2026-11-17", "2026-11-18", "2026-11-19"])
      expect(await addOwnPractice(deps(), coach, T, { ...mon, date, minutes: 45 })).toMatchObject({ ok: true });
    const list = await upcomingOwnPractices(deps(), T);
    expect(list).toHaveLength(4);
    expect(list[0]).toMatchObject({ location: "Masters Gym", minutes: 90, series: null, addedBy: "P 5550001" });
    expect(list[0].startsAt.toISOString()).toBe("2026-11-16T23:00:00.000Z"); // 6 PM Eastern
    expect(await ownPracticeLocations(deps(), T)).toEqual(["Masters Gym"]);
  });

  it("weekly until a date: same weekday and time each week (across the time change), duplicates skipped", async () => {
    const E = { org: "east-ridge", teamId: er };
    const max = person("5550004");
    expect(await addOwnPractice(deps(), max, E, { ...mon, date: "2026-11-23" })).toMatchObject({ ok: true });
    const r = await addOwnPractice(deps(), max, E, { ...mon, weeklyUntil: "2027-03-15" });
    if (!r.ok) throw new Error(r.message);
    expect(r.added).toHaveLength(17); // Nov 16 … Mar 15, minus Nov 23 already there
    expect(r.skipped.map((d) => d.toISOString())).toEqual(["2026-11-23T23:00:00.000Z"]);
    const list = await upcomingOwnPractices(deps(), E);
    expect(list.at(-1)?.startsAt.toISOString()).toBe("2027-03-15T22:00:00.000Z"); // still 6 PM after the clocks change
    // Removing "this and later weeks" from Jan 4 on leaves Nov 16 – Dec 28 and the separate Nov 23.
    const jan4 = list.find((p) => p.startsAt.toISOString() === "2027-01-04T23:00:00.000Z")!;
    expect(await removeOwnPractice(deps(), max, E, jan4.id, true)).toEqual({ ok: true, removed: 11 });
    expect(await upcomingOwnPractices(deps(), E)).toHaveLength(7);
    // Just one.
    const first = (await upcomingOwnPractices(deps(), E))[0];
    expect(await removeOwnPractice(deps(), max, E, first.id, false)).toEqual({ ok: true, removed: 1 });
    expect(await removeOwnPractice(deps(), coach, E, (await upcomingOwnPractices(deps(), E))[0].id, false)).toMatchObject({ ok: false });
  });

  it("checks what's entered, and past practices stay", async () => {
    const T = { org: "thunder", teamId: thunder };
    expect(cleanLocation("  Masters  Gym ")).toBe("Masters Gym");
    expect(cleanLocation("=HYPERLINK(1)")).toBeNull();
    expect(cleanLocation("<b>x</b>")).toBeNull();
    expect(await addOwnPractice(deps(), coach, T, { ...mon, minutes: 10 })).toMatchObject({ ok: false });
    expect(await addOwnPractice(deps(), coach, T, { ...mon, date: "2026-11-09" })).toMatchObject({ ok: false });
    expect(await addOwnPractice(deps(), coach, T, { ...mon, weeklyUntil: "2026-11-01" })).toMatchObject({ ok: false });
    expect(await addOwnPractice(deps(), coach, T, { ...mon, weeklyUntil: "2028-11-01" })).toMatchObject({ ok: false });
    await addOwnPractice(deps(), coach, T, mon);
    const [p] = await upcomingOwnPractices(deps(), T);
    now = new Date("2026-11-17T12:00:00Z");
    expect(await upcomingOwnPractices(deps(), T)).toHaveLength(0);
    expect(await removeOwnPractice(deps(), coach, T, p.id, false)).toMatchObject({ ok: false });
  });
});
