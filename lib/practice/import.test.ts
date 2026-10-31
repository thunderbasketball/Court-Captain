import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../testing/db";
import { zonedTime } from "../time";
import { importPractice, parsePracticeTabs } from "./import";

const gyms = [
  ["Gym", "Court", "Active"],
  ["Action Church", "North", "TRUE"],
  ["Action Church", "South", "TRUE"],
  ["Heritage HS", "Main", "FALSE"],
];
const slots = (...rows: string[][]) => [["Gym", "Court", "Time", "Available", "Team", "Booked By"], ...rows];
const blackouts = [
  ["Date", "Gym", "Time", "Notes", "Blocked By"],
  ["11/26/2026", "ALL Gyms", "ALL", "Thanksgiving", ""],
];

describe("practice import", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Epps', 'Girls', '{4}', 4, 'REC', 'x')",
    );
  });

  const tabs = slots(
    ["Action Church", "North", "11/9/2026 6:00 PM", "FALSE", "4G Epps", "Earl Epps"],
    ["Action Church", "North", "11/9/2026 7:00 PM", "TRUE", "", ""],
    ["Action Church", "South", "11/26/2026 6:00 PM", "FALSE", "BLACKOUT: Turkey Day", ""],
    ["Action Church", "South", "11/26/2026 7:00 PM", "TRUE", "", ""],
  );
  const opts = { by: "Earl Epps", dryRun: false };

  it("imports courts, slots, bookings and blackouts (with the holiday note)", async () => {
    const r = await importPractice(db.pool, parsePracticeTabs({ gyms, slots: tabs, blackouts }), opts);
    expect(r).toMatchObject({
      gyms: 2,
      courts: 3,
      slotsNew: 4,
      booked: { "4G Epps": 1 },
      blackouts: 2,
      blackoutDates: 1,
      unknownTeams: [],
    });
    expect((await db.pool.query("select day::text, gym_id, minute_of_day, reason from blackouts")).rows).toEqual([
      { day: "2026-11-26", gym_id: null, minute_of_day: null, reason: "Thanksgiving" },
    ]);
    const s = await db.pool.query(
      `select g.name gym, c.name court, s.starts_at, t.name team, s.blackout, s.note, s.booked_by
       from slots s join courts c on c.id = s.court_id join gyms g on g.id = c.gym_id left join teams t on t.id = s.team_id order by s.starts_at, c.name`,
    );
    expect(s.rows[0]).toMatchObject({ court: "Goal #1", starts_at: zonedTime(2026, 11, 9, 18), team: "4G Epps", booked_by: "Earl Epps" });
    expect(s.rows[1]).toMatchObject({ team: null, blackout: false, booked_by: null });
    // Both Thanksgiving slots are blacked out: one marked "BLACKOUT: ..." in PracticeSlots, one from the BlackOuts tab.
    expect(s.rows.slice(2).map((x) => [x.blackout, x.note])).toEqual([
      [true, "Turkey Day"],
      [true, "Thanksgiving"],
    ]);
    expect(
      (await db.pool.query("select c.active from courts c join gyms g on g.id = c.gym_id where g.name = 'Heritage HS'")).rows[0].active,
    ).toBe(false);
  });

  it("running again leaves existing slots alone; a dry run changes nothing", async () => {
    await importPractice(db.pool, parsePracticeTabs({ gyms, slots: tabs, blackouts }), opts);
    await db.pool.query("update slots set team_id = null, booked_by = null"); // released in the app
    const r = await importPractice(db.pool, parsePracticeTabs({ gyms, slots: tabs, blackouts }), opts);
    expect(r).toMatchObject({ gyms: 0, courts: 0, slotsNew: 0, slotsExisting: 4 });
    expect((await db.pool.query("select count(*)::int n from slots where team_id is not null")).rows[0].n).toBe(0);
    await db.reset();
    await importPractice(db.pool, parsePracticeTabs({ gyms, slots: tabs, blackouts }), { ...opts, dryRun: true });
    expect((await db.pool.query("select count(*)::int n from slots")).rows[0].n).toBe(0);
  });

  it("stops on an unknown team or a bad row", async () => {
    const bad = slots(["Action Church", "North", "11/9/2026 6:00 PM", "FALSE", "9Z Nobody", "X"]);
    await expect(importPractice(db.pool, parsePracticeTabs({ gyms, slots: bad, blackouts }), opts)).rejects.toThrow(/9Z Nobody/);
    expect((await db.pool.query("select count(*)::int n from slots")).rows[0].n).toBe(0);
    const p = parsePracticeTabs({ gyms, slots: slots(["Action Church", "North", "someday", "", "", ""]), blackouts });
    expect(p.errors[0].message).toMatch(/Can't read the time/);
  });
});
