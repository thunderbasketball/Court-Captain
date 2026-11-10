import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { getPractice, listPractices, myPracticesToday, setPracticeStatus } from "./practice-attendance";
import { addPlayers } from "./rosters";
import { createTestDb } from "./testing/db";

const person = (coachId: string, firstName: string, isDirector = false): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector,
  isCoach: true,
  requestPending: false,
  hasThunderRole: true,
});
const director = person("9913694", "Earl", true);
const parent = person("5550001", "Pam"); // Team Parent on team A
const otherCoach = person("5550002", "Ollie"); // Head Coach on team B

describe("practice attendance", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  let now = new Date("2026-11-10T12:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  let teamA = "";
  let teamB = "";
  let slotA = "";
  let slotOld = "";

  beforeEach(async () => {
    await db.reset();
    now = new Date("2026-11-10T12:00:00Z");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Pam', 'X', '4235550001'), ('5550002', 'Ollie', 'X', '4235550002')`,
    );
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x'), ('5B B', 'Boys', '{5}', 5, 'REC', 'x') returning id::text`,
    );
    [teamA, teamB] = t.rows.map((r) => r.id);
    await db.pool.query(
      `insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'TeamParent', 'x'), ($2, '5550002', 'HeadCoach', 'x')`,
      [teamA, teamB],
    );
    for (const [id, first, gender, grade] of [
      ["r1", "Ava", "Girls", "4"],
      ["r2", "Bea", "Girls", "4"],
      ["r3", "Cy", "Boys", "5"],
    ]) {
      await db.pool.query(
        `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw, imported_at, imported_by)
         values ($1, $1, $2, 'Kid', $3, $4, $5, 'x', '{}', now(), 'x')`,
        [id, first, gender, grade, Number(grade)],
      );
    }
    await addPlayers(deps(), director, teamA, ["r1", "r2"]);
    await addPlayers(deps(), director, teamB, ["r3"]);
    const g = await db.pool.query<{ id: string }>("insert into gyms (name) values ('Gym') returning id::text");
    const c = await db.pool.query<{ id: string }>("insert into courts (gym_id, name) values ($1, 'Main') returning id::text", [
      g.rows[0].id,
    ]);
    const s = await db.pool.query<{ id: string }>(
      `insert into slots (court_id, starts_at, team_id, created_by) values
         ($1, '2026-11-10T23:00:00Z', $2, 'x'),   -- today 6 PM, team A
         ($1, '2026-11-11T23:00:00Z', $3, 'x'),   -- tomorrow, team B
         ($1, '2026-11-12T23:00:00Z', null, 'x'), -- open: not a practice
         ($1, '2026-08-01T23:00:00Z', $2, 'x')    -- over 60 days ago
       returning id::text`,
      [c.rows[0].id, teamA, teamB],
    );
    slotA = s.rows[0].id;
    slotOld = s.rows[3].id;
  });

  it("booked practices show in Events: the Director sees all, staff see their own teams'", async () => {
    expect((await listPractices(deps(), director)).map((p) => [p.teamName, p.gym, p.court, p.total])).toEqual([
      ["4G A", "Gym", "Main", 2],
      ["5B B", "Gym", "Main", 1],
    ]);
    expect((await listPractices(deps(), parent)).map((p) => p.teamName)).toEqual(["4G A"]);
    expect(await myPracticesToday(deps(), parent, new Date("2026-11-10T05:00:00Z"), new Date("2026-11-11T05:00:00Z"))).toBe(1);
    expect(await myPracticesToday(deps(), otherCoach, new Date("2026-11-10T05:00:00Z"), new Date("2026-11-11T05:00:00Z"))).toBe(0);
    expect(slotOld).toBeTruthy();
  });

  it("team staff (any role) and the Director take attendance from the roster; who marked it is recorded", async () => {
    expect(await getPractice(deps(), otherCoach, slotA)).toBeNull();
    // Marking opens 15 minutes before the 6 PM start.
    expect(await setPracticeStatus(deps(), parent, { slotId: slotA, registrantId: "r1", status: "here" })).toEqual({
      ok: false,
      message: "Attendance opens 15 minutes before the start.",
    });
    now = new Date("2026-11-10T22:45:00Z");
    let p = await getPractice(deps(), parent, slotA);
    expect(p?.players.map((x) => [x.firstName, x.status])).toEqual([
      ["Ava", "unknown"],
      ["Bea", "unknown"],
    ]);
    expect(await setPracticeStatus(deps(), parent, { slotId: slotA, registrantId: "r1", status: "here" })).toMatchObject({
      ok: true,
      updatedBy: "Pam X",
    });
    expect(await setPracticeStatus(deps(), director, { slotId: slotA, registrantId: "r2", status: "absent" })).toMatchObject({
      ok: true,
      updatedBy: "Earl X",
    });
    expect(await setPracticeStatus(deps(), otherCoach, { slotId: slotA, registrantId: "r1", status: "absent" })).toEqual({
      ok: false,
      message: "You can't take attendance for this practice.",
    });
    expect(await setPracticeStatus(deps(), parent, { slotId: slotA, registrantId: "r3", status: "here" })).toEqual({
      ok: false,
      message: "That player isn't on this team.",
    });
    p = await getPractice(deps(), parent, slotA);
    expect(p).toMatchObject({ here: 1, absent: 1, total: 2 });
    await setPracticeStatus(deps(), parent, { slotId: slotA, registrantId: "r1", status: "unknown" });
    expect((await getPractice(deps(), parent, slotA))?.players[0]).toMatchObject({ status: "unknown", updatedBy: null });
    // …and closes 24 hours after it.
    now = new Date("2026-11-11T23:00:01Z");
    expect(await setPracticeStatus(deps(), parent, { slotId: slotA, registrantId: "r1", status: "here" })).toEqual({
      ok: false,
      message: "Attendance closed 24 hours after the event.",
    });
  });

  it("an open (unbooked) slot isn't a practice", async () => {
    const open = (await db.pool.query<{ id: string }>("select id::text from slots where team_id is null")).rows[0].id;
    expect(await getPractice(deps(), director, open)).toBeNull();
    expect(await setPracticeStatus(deps(), director, { slotId: open, registrantId: "r1", status: "here" })).toMatchObject({ ok: false });
  });
});
