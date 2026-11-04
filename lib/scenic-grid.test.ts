import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { dayGrid, gridBlocks, setGameLength } from "./scenic-grid";
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
});
