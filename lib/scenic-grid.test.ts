import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import {
  clearDayOverride,
  dayGrid,
  gameLength,
  gridBlocks,
  gymBlocks,
  slotsFromBreaks,
  programGameLength,
  setDayOverride,
  setGameLength,
  setProgramGameLength,
} from "./scenic-grid";
import { createTestDb, grant } from "./testing/db";

describe("Scheduler grid blocks", () => {
  it("splits open hours into whole games from when the gym opens", () => {
    expect(gridBlocks("09:00", "12:00", 55)).toEqual([
      ["09:00", "09:55"],
      ["09:55", "10:50"],
      ["10:50", "11:45"],
    ]);
    expect(gridBlocks("13:30", "15:00", 45)).toEqual([
      ["13:30", "14:15"],
      ["14:15", "15:00"],
    ]);
    expect(gridBlocks("09:00", "09:30", 55)).toEqual([]);
  });
});

describe("Scheduler grid blocks with Custom times (break points)", () => {
  it("games run back to back from the first break point; from each break point on, the next game takes its length", () => {
    const slots = slotsFromBreaks(
      [
        { start: "12:00", minutes: 55 },
        { start: "09:00", minutes: 50 },
        { start: "14:00", minutes: 60 },
      ],
      "16:30",
    );
    expect(slots.map((x) => `${x.start}/${x.minutes}`)).toEqual([
      "09:00/50",
      "09:50/50",
      "10:40/50",
      "11:30/50", // starts before 12:00: keeps 50
      "12:20/55", // the next game takes the new length (no gap)
      "13:15/55",
      "14:10/60",
      "15:10/60", // 16:10 + 60 would run past 16:30
    ]);
    // A gym uses the slots its hours fit.
    expect(gymBlocks({ minutes: 50, slots }, "09:30", "14:00")).toEqual([
      ["09:50", "10:40"],
      ["10:40", "11:30"],
      ["11:30", "12:20"],
      ["12:20", "13:15"],
    ]);
    expect(gymBlocks({ minutes: 55, slots: null }, "09:00", "11:00")).toEqual(gridBlocks("09:00", "11:00", 55));
  });
});

describe("Scheduler grid", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-02T15:00:00Z") });
  const person = (coachId: string, firstName: string): SessionUser => ({
    coachId,
    firstName,
    lastName: "X",
    isDirector: false,
    isCoach: false,
    requestPending: false,
    hasThunderRole: false,
  });
  const fay = person("5550004", "Fay");

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(`insert into users (coach_id, first_name, last_name, cell) values ('5550004', 'Fay', 'X', '4235550004')`);
    await grant(db.pool, "5550004 scenic-city Director");
    await db.pool.query(`insert into game_days (day, created_by) values ('2027-01-09', 't'), ('2027-01-16', 't')`);
    const p = await db.pool.query<{ id: string }>(
      `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by)
       values ('Baylor School', 'School', true, false, true, 't') returning id::text`,
    );
    const g = await db.pool.query<{ id: string }>(
      `insert into partner_gyms (partner_id, name, created_by) values ($1, 'Main Gym', 't') returning id::text`,
      [p.rows[0].id],
    );
    for (const [name, starts, ends] of [
      ["Court 10", "09:00", "12:00"],
      ["Court 2", "10:00", "12:00"],
    ]) {
      const c = await db.pool.query<{ id: string }>(
        `insert into partner_courts (gym_id, name, created_by) values ($1, $2, 't') returning id::text`,
        [g.rows[0].id, name],
      );
      await db.pool.query(
        `insert into court_hours (court_id, game_day_id, starts, ends, set_by)
         select $1, id, $2, $3, 't' from game_days where day = '2027-01-09'`,
        [c.rows[0].id, starts, ends],
      );
    }
  });

  it("lists each gym open that Game Day with its courts' hours; game length 55 unless the Scheduler changes it", async () => {
    expect(await dayGrid(deps(), fay, "2027-01-09")).toBeNull(); // not a Scheduler yet
    expect(await setGameLength(deps(), fay, "2027-01-09", 60)).toMatchObject({ ok: false });
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'scenic-city', 'scheduling', 'test')",
    );
    expect(await dayGrid(deps(), fay, "2027-01-09")).toMatchObject({
      minutes: 55,
      setBy: null,
      gyms: [
        {
          name: "Main Gym",
          host: "Baylor School",
          courts: [
            { name: "Court 2", starts: "10:00", ends: "12:00" },
            { name: "Court 10", starts: "09:00", ends: "12:00" },
          ],
        },
      ],
    });
    expect((await dayGrid(deps(), fay, "2027-01-16"))!.gyms).toEqual([]);
    expect(await dayGrid(deps(), fay, "2027-01-10")).toBeNull(); // not a Game Day
    expect(await setGameLength(deps(), fay, "2027-01-09", 10)).toEqual({
      ok: false,
      message: "Game length must be 20 to 180 minutes.",
    });
    expect(await setGameLength(deps(), fay, "2027-01-10", 60)).toEqual({ ok: false, message: "That isn't a Game Day." });
    expect(await setGameLength(deps(), fay, "2027-01-09", 60)).toEqual({ ok: true, moved: 0, off: [] });
    expect(await dayGrid(deps(), fay, "2027-01-09")).toMatchObject({ minutes: 60, setBy: "Fay X" });
    // An organization that hosts: its gym marked Partner Games that day, with its courts in the order they were added.
    await db.pool.query(
      `insert into organizations (slug, name, short_name) values ('ehhs', 'EHHS', 'EHHS') on conflict do nothing;
       insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug)
         values ('East Hamilton HS', 'School', true, true, true, 't', 'ehhs');
       insert into gyms (name, org) values ('EH Gym', 'ehhs');
       insert into courts (gym_id, name) select id, 'Main' from gyms where name = 'EH Gym';
       insert into courts (gym_id, name) select id, 'Aux' from gyms where name = 'EH Gym';
       insert into gym_availability (gym_id, day, use, starts, ends, set_by)
         select id, '2027-01-16', 'partner', '09:00', '21:00', 't' from gyms where name = 'EH Gym';`,
    );
    const eh = (await dayGrid(deps(), fay, "2027-01-16"))!.gyms;
    expect(eh.map((g) => [g.name, g.host, g.courts.map((c) => `${c.name} ${c.starts}-${c.ends}`)])).toEqual([
      ["EH Gym", "East Hamilton HS", ["Main 09:00-21:00", "Aux 09:00-21:00"]],
    ]);
    // Practice goals are halves of one court: a gym with only goals is one court for games.
    await db.pool.query(
      `insert into gyms (name, org) values ('Goal Gym', 'ehhs');
       insert into courts (gym_id, name) select id, 'Goal #1' from gyms where name = 'Goal Gym';
       insert into courts (gym_id, name) select id, 'Goal #2' from gyms where name = 'Goal Gym';
       insert into gym_availability (gym_id, day, use, starts, ends, set_by)
         select id, '2027-01-16', 'partner', '09:00', '12:00', 't' from gyms where name = 'Goal Gym';`,
    );
    const goals = (await dayGrid(deps(), fay, "2027-01-16"))!.gyms.find((g) => g.name === "Goal Gym")!;
    expect(goals.courts.map((c) => c.name)).toEqual(["Main"]);
  });

  it("game length is the program's unless the day overrides it (its own length or time slots); Cancel goes back", async () => {
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'scenic-city', 'scheduling', 'test')",
    );
    const prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2027-01-01', '2027-03-01', '2026-11-01', '2026-12-15', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query("insert into program_game_days (program_id, game_day_id, added_by) select $1, id, 't' from game_days", [
      prog,
    ]);
    expect(await programGameLength(deps(), fay, prog)).toEqual({ minutes: 55, setBy: null });
    // Program-wide: every Game Day without an override.
    expect(await setProgramGameLength(deps(), fay, prog, 10)).toMatchObject({ ok: false });
    expect(await setProgramGameLength(deps(), fay, "x", 60)).toEqual({ ok: false, message: "Pick a program." });
    expect(await setProgramGameLength(deps(), fay, prog, 60)).toEqual({ ok: true, moved: 0, off: [] });
    expect(await programGameLength(deps(), fay, prog)).toEqual({ minutes: 60, setBy: "Fay X" });
    expect(await gameLength(deps(), fay, "2027-01-09")).toMatchObject({
      minutes: 60,
      override: false,
      breaks: null,
      programMinutes: 60,
      programName: "Winter",
      opens: "09:00",
      closes: "12:00",
    });
    // The day's own game length.
    expect(await setDayOverride(deps(), fay, "2027-01-09", { minutes: 10 })).toMatchObject({ ok: false });
    expect(await setDayOverride(deps(), fay, "2027-01-09", { minutes: 40 })).toEqual({ ok: true, moved: 0, off: [] });
    expect(await gameLength(deps(), fay, "2027-01-09")).toMatchObject({ minutes: 40, override: true, breaks: null });
    // Custom times: break points, within the hosts' availability (courts open 9:00–12:00 that day).
    const set = (breaks: unknown) => setDayOverride(deps(), fay, "2027-01-09", { breaks });
    expect(await set([{ start: "9am", minutes: 50 }])).toEqual({
      ok: false,
      message: "Each break point needs a time and a slot length of 20 to 180 minutes.",
    });
    expect(await set([{ start: "09:00", minutes: 10 }])).toMatchObject({ ok: false });
    expect(await set([])).toEqual({ ok: false, message: "Give 1 to 20 break points." });
    expect(
      await set([
        { start: "09:00", minutes: 50 },
        { start: "09:00", minutes: 60 },
      ]),
    ).toEqual({ ok: false, message: "Two break points have the same time." });
    expect(
      await set([
        { start: "08:00", minutes: 50 },
        { start: "11:30", minutes: 45 },
      ]),
    ).toEqual({ ok: false, message: "No host is open for a whole slot at 8:00 AM (50 min), 11:30 AM (45 min)." });
    expect(
      await set([
        { start: "10:30", minutes: 30 },
        { start: "09:00", minutes: 45 },
      ]),
    ).toEqual({ ok: true, moved: 0, off: [] });
    expect(await gameLength(deps(), fay, "2027-01-09")).toMatchObject({
      minutes: 45, // the first break point's
      override: true,
      breaks: [
        { start: "09:00", minutes: 45 },
        { start: "10:30", minutes: 30 },
      ],
      setBy: "Fay X",
    });
    const grid = (await dayGrid(deps(), fay, "2027-01-09"))!;
    expect(grid.slots!.map((x) => `${x.start}/${x.minutes}`)).toEqual([
      "09:00/45",
      "09:45/45",
      "10:30/30", // from 10:30 on, 30-minute slots
      "11:00/30",
      "11:30/30",
    ]);
    // The program's length no longer changes that day; the other day follows it.
    expect(await setProgramGameLength(deps(), fay, prog, 70)).toMatchObject({ ok: true });
    expect((await gameLength(deps(), fay, "2027-01-09"))!.minutes).toBe(45);
    expect((await gameLength(deps(), fay, "2027-01-16"))!.minutes).toBe(70);
    // Cancel: back to the program's setting.
    expect(await clearDayOverride(deps(), fay, "2027-01-09")).toEqual({ ok: true, moved: 0, off: [] });
    expect(await gameLength(deps(), fay, "2027-01-09")).toMatchObject({
      minutes: 70,
      override: false,
      breaks: null,
      slots: null,
      setBy: null,
    });
  });
});
