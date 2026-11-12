import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, grant } from "./testing/db";
import { addScrimmage, addsScrimmages, gamesToOfficiate, removeScrimmage, scrimmageChoices, teamScrimmages, updateScrimmage, upcomingScrimmages } from "./scrimmages";
import { eventWhen } from "./event-attendance";

describe("scrimmages", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  const now = new Date("2026-11-12T15:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const person = (coachId: string, extra: object = {}) =>
    ({ coachId, firstName: "P", lastName: coachId, isDirector: false, thunderAreas: [], ...extra }) as never;
  const director = person("5550001", { isDirector: true, thunderAreas: ["events"] });
  const head = person("5550002"); // Head Coach of 4G A
  const parent = person("5550003"); // Team Parent of 4G A
  let program = "";
  let a = "";
  let b = "";
  let court = "";
  let gym = "";
  // Saturday Nov 14, 10 AM Eastern, for an hour and a half.
  const when = { date: "2026-11-14", time: "10:00", minutes: 90 };

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('5550001', 'P', '5550001', '4235550001'), ('5550002', 'P', '5550002', '4235550002'), ('5550003', 'P', '5550003', '4235550003')`,
    );
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x'), ('4G B', 'Girls', '{4}', 4, 'REC', 'x') returning id::text`,
    );
    [a, b] = t.rows.map((r) => r.id);
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550002', 'HeadCoach', 'x'), ($1, '5550003', 'TeamParent', 'x')", [a]);
    program = (
      await db.pool.query<{ id: string }>(
        "insert into player_programs (org, name, reg_opens, starts_on, ends_on, created_by) values ('thunder', 'Winter', '2026-10-01', '2026-11-01', '2027-02-28', 'x') returning id::text",
      )
    ).rows[0].id;
    gym = (await db.pool.query<{ id: string }>("insert into gyms (name) values ('Action Church') returning id::text")).rows[0].id;
    court = (await db.pool.query<{ id: string }>("insert into courts (gym_id, name) values ($1, 'Goal #1') returning id::text", [gym])).rows[0].id;
    const goal2 = (await db.pool.query<{ id: string }>("insert into courts (gym_id, name) values ($1, 'Goal #2') returning id::text", [gym])).rows[0].id;
    await db.pool.query("insert into slots (court_id, starts_at, created_by) values ($1, '2026-11-14T15:00:00Z', 'x')", [goal2]);
    // Hour slots 9, 10, 11 AM and noon Eastern on Nov 14.
    await db.pool.query(
      `insert into slots (court_id, starts_at, created_by) values ($1, '2026-11-14T14:00:00Z', 'x'), ($1, '2026-11-14T15:00:00Z', 'x'),
         ($1, '2026-11-14T16:00:00Z', 'x'), ($1, '2026-11-14T17:00:00Z', 'x')`,
      [court],
    );
  });

  it("Directors of Teams or Events add one at a gym: that court time is blocked, and freed when it's removed", async () => {
    expect(await addsScrimmages(db.pool, director, "thunder")).toBe(true);
    expect(await addsScrimmages(db.pool, head, "thunder")).toBe(false); // the program card's + is for Directors
    expect((await scrimmageChoices(deps(), "thunder")).teams.map((t) => t.name)).toEqual(["4G A", "4G B"]);
    expect((await scrimmageChoices(deps(), "thunder")).gyms).toEqual([{ id: gym, name: "Action Church" }]); // gyms, not goals

    const r = await addScrimmage(deps(), director, "thunder", program, { home: a, away: b, ...when, gymId: gym });
    expect(r).toMatchObject({ ok: true, blocked: 3 }); // the whole gym: Goal #1's 10 and 11 AM, Goal #2's 10 AM
    const blocked = await db.pool.query("select starts_at from slots where blackout and note = 'Scrimmage' order by starts_at");
    expect(blocked.rows.map((x) => x.starts_at.toISOString())).toEqual([
      "2026-11-14T15:00:00.000Z",
      "2026-11-14T15:00:00.000Z",
      "2026-11-14T16:00:00.000Z",
    ]);
    const list = await upcomingScrimmages(deps(), "thunder", program);
    expect(list).toMatchObject([{ home: "4G A", away: "4G B", outside: false, place: "Action Church", atOurGym: true, minutes: 90 }]);

    // The same court then: refused (another scrimmage, or those slots now blocked).
    expect(await addScrimmage(deps(), director, "thunder", program, { home: b, away: "", awayName: "Signal 4G", ...when, gymId: gym })).toMatchObject({
      ok: false,
    });
    expect(await removeScrimmage(deps(), parent, "thunder", list[0].id)).toMatchObject({ ok: false });
    expect(await removeScrimmage(deps(), director, "thunder", list[0].id)).toEqual({ ok: true });
    const open = await db.pool.query("select count(*)::int as n from slots where not blackout and team_id is null");
    expect(open.rows[0].n).toBe(5);
  });

  it("a Head Coach adds one for their team, against an outside team at any place; checks what's typed", async () => {
    const outside = { home: a, away: "", awayName: "Signal Mountain 4G", ...when, location: "Signal Mountain Middle School" };
    expect(await addScrimmage(deps(), parent, "thunder", program, outside)).toMatchObject({ ok: false }); // not a Head Coach
    expect(await addScrimmage(deps(), head, "thunder", program, { ...outside, home: b })).toMatchObject({ ok: false }); // not their team
    expect(await addScrimmage(deps(), head, "thunder", program, outside)).toMatchObject({ ok: true, blocked: 0 });
    expect(await upcomingScrimmages(deps(), "thunder", program)).toMatchObject([
      { home: "4G A", away: "Signal Mountain 4G", outside: true, place: "Signal Mountain Middle School", atOurGym: false },
    ]);
    expect(await addScrimmage(deps(), director, "thunder", program, { ...outside, awayName: "=HYPERLINK()" })).toMatchObject({ ok: false });
    expect(await addScrimmage(deps(), director, "thunder", program, { ...outside, away: a, awayName: "" })).toMatchObject({ ok: false }); // same team
    expect(await addScrimmage(deps(), director, "thunder", program, { ...outside, date: "2026-11-01" })).toMatchObject({ ok: false }); // past
    expect(await addScrimmage(deps(), director, "thunder", program, { ...outside, minutes: 45 })).toMatchObject({ ok: false });
    // TBD: either team picked later (a Head Coach still needs their own team in it).
    expect(await addScrimmage(deps(), director, "thunder", program, { ...outside, home: "tbd", away: "tbd", minutes: 30 })).toMatchObject({ ok: true });
    expect(await addScrimmage(deps(), head, "thunder", program, { ...outside, away: "tbd", date: "2026-11-15" })).toMatchObject({ ok: true });
    expect(await addScrimmage(deps(), head, "thunder", program, { ...outside, home: "tbd", away: "tbd" })).toMatchObject({ ok: false });
    expect((await upcomingScrimmages(deps(), "thunder", program)).map((x) => `${x.home} vs ${x.away} ${x.minutes}`)).toEqual([
      "4G A vs Signal Mountain 4G 90",
      "TBD vs TBD 30",
      "4G A vs TBD 90",
    ]);
    // A booked practice on the court then: refused, naming the team.
    await db.pool.query("update slots set team_id = $1, booked_by = 'x' where starts_at = '2026-11-14T15:00:00Z'", [b]);
    expect(await addScrimmage(deps(), director, "thunder", program, { home: a, away: b, ...when, gymId: gym })).toEqual({
      ok: false,
      message: "That gym has a practice booked then (4G B). Pick another gym or time, or cancel that practice first.",
    });
  });

  it("shows on both teams' schedules (vs each other, an outside team or TBD), with attendance by that team's scrimmage", async () => {
    const r = await addScrimmage(deps(), director, "thunder", program, { home: a, away: b, ...when, gymId: gym });
    if (!r.ok) throw new Error(r.message);
    const o = await addScrimmage(deps(), director, "thunder", program, { home: b, away: "", awayName: "Signal 4G", ...when, date: "2026-11-15", gymId: "", location: "Signal Mountain MS" });
    if (!o.ok) throw new Error(o.message);
    const t = await teamScrimmages(deps(), "thunder", [a, b]);
    expect(t[a]).toMatchObject([{ id: r.id, opponent: "4G B", outside: false, minutes: 90 }]);
    expect(t[b]).toMatchObject([{ id: r.id, opponent: "4G A", outside: false }, { id: o.id, opponent: "Signal 4G", outside: true, place: "Signal Mountain MS" }]);
    expect(await eventWhen(db.pool, { org: "thunder", teamId: a }, "scrimmage", r.id)).toMatchObject({ timed: true });
    expect(await eventWhen(db.pool, { org: "thunder", teamId: a }, "scrimmage", o.id)).toBeNull(); // not its scrimmage
    // Once over, it's off the schedule.
    expect(await teamScrimmages({ pool: db.pool, now: () => new Date("2026-11-20T12:00:00Z") }, "thunder", [a, b])).toEqual({});
  });

  it("schedules officials from an Officials Group: shows on that group's page for its Officials Assigners", async () => {
    const ORG = "sc-officials";
    await db.pool.query(`delete from org_role_types where org = '${ORG}'; delete from organizations where slug = '${ORG}'`);
    await db.pool.query(`insert into organizations (slug, name, short_name, kind) values ('${ORG}', 'Scenic City Officials', 'SCO', 'Officials')`);
    await db.pool.query(`insert into org_role_types (org, role) select '${ORG}', r from unnest(array['Request', 'Coach', 'Director', 'Admin', 'Owner']) r`);
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550008', 'Otto', 'X', '4235550008')");
    await grant(db.pool, `5550008 ${ORG} Director`);
    await db.pool.query(`insert into director_areas (coach_id, org, area, granted_by) values ('5550008', '${ORG}', 'officials', 't')`);
    const otto = person("5550008");
    expect((await scrimmageChoices(deps(), "thunder")).officials).toEqual([]); // not a group until CourtSync is on
    await db.pool.query(
      `insert into org_features (org, feature, source, turned_on_by) values ('${ORG}', 'court-officials', 'setup', 't'), ('${ORG}', 'court-sync', 'setup', 't')`,
    );
    expect((await scrimmageChoices(deps(), "thunder")).officials).toEqual([{ org: ORG, name: "Scenic City Officials" }]);

    const outside = { home: a, away: "", awayName: "Signal 4G", ...when, gymId: "", location: "Signal Mountain MS" };
    expect(await addScrimmage(deps(), director, "thunder", program, { ...outside, officials: "scenic-city" })).toMatchObject({ ok: false }); // not a group
    const r = await addScrimmage(deps(), director, "thunder", program, { ...outside, officials: ORG });
    if (!r.ok) throw new Error(r.message);
    await addScrimmage(deps(), director, "thunder", program, { ...outside, date: "2026-11-15" }); // no officials
    expect(await gamesToOfficiate(deps(), director, ORG)).toBeNull(); // not the group's
    expect(await gamesToOfficiate(deps(), otto, ORG)).toMatchObject([
      { id: r.id, org: "thunder", home: "4G A", away: "Signal 4G", minutes: 90, place: "Signal Mountain MS" },
    ]);
    const [s] = await upcomingScrimmages(deps(), "thunder", program);
    expect(s).toMatchObject({ officials: "Scenic City Officials", form: { officials: ORG } });
    // Unticked on edit: off the group's page.
    expect(await updateScrimmage(deps(), director, "thunder", r.id, { ...s.form, away: "", gymId: "", officials: "" })).toMatchObject({ ok: true });
    expect(await gamesToOfficiate(deps(), otto, ORG)).toEqual([]);
  });

  it("edits one: its gym time is freed and the new time checked and blocked; a Head Coach keeps their team in it", async () => {
    const r = await addScrimmage(deps(), director, "thunder", program, { home: a, away: b, ...when, gymId: gym });
    if (!r.ok) throw new Error(r.message);
    const [s] = await upcomingScrimmages(deps(), "thunder", program);
    expect(s.form).toEqual({ home: a, away: b, awayName: "", date: "2026-11-14", time: "10:00", minutes: "90", gymId: gym, location: "", officials: "" });
    // Move it an hour later, as TBD vs an outside team: 10 AM opens, noon is blocked.
    expect(await updateScrimmage(deps(), director, "thunder", r.id, { ...s.form, home: "tbd", away: "", awayName: "Signal 4G", time: "11:00" })).toMatchObject({
      ok: true,
      blocked: 2, // Goal #1's 11 AM and noon (Goal #2's 10 AM hour ends as it starts)
    });
    const blocked = await db.pool.query("select starts_at from slots where scrimmage_id = $1 order by starts_at", [r.id]);
    expect(blocked.rows.map((x) => x.starts_at.toISOString())).toEqual(["2026-11-14T16:00:00.000Z", "2026-11-14T17:00:00.000Z"]);
    expect((await upcomingScrimmages(deps(), "thunder", program))[0]).toMatchObject({ home: "TBD", away: "Signal 4G", outside: true });

    // The Head Coach of 4G A: not while their team isn't in it; then only keeping it in.
    const form = { ...s.form, home: "tbd", away: "", awayName: "Signal 4G", time: "11:00" };
    expect(await updateScrimmage(deps(), head, "thunder", r.id, { ...form, home: a })).toMatchObject({ ok: false });
    expect(await updateScrimmage(deps(), director, "thunder", r.id, { ...form, home: a })).toMatchObject({ ok: true });
    expect(await updateScrimmage(deps(), head, "thunder", r.id, { ...form, home: b })).toMatchObject({ ok: false });
    expect(await updateScrimmage(deps(), head, "thunder", r.id, { ...form, home: a, minutes: 30, gymId: "", location: "Signal Mountain MS" })).toMatchObject({
      ok: true,
      blocked: 0,
    });
    expect((await db.pool.query("select count(*)::int as n from slots where blackout")).rows[0].n).toBe(0); // the gym's time freed
    expect(await updateScrimmage(deps(), parent, "thunder", r.id, { ...form, home: a })).toMatchObject({ ok: false });
    expect(await updateScrimmage({ pool: db.pool, now: () => new Date("2026-11-14T16:05:00Z") }, director, "thunder", r.id, { ...form, home: a, date: "2026-11-20" })).toMatchObject({
      ok: false,
      message: "That scrimmage has started; it stays as it was.",
    });
  });
});
