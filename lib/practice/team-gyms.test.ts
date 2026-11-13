import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../auth/service";
import { createTestDb } from "../testing/db";
import { zonedTime } from "../time";
import { bookSlot } from "./booking";
import { setTeamGym, teamGyms } from "./team-gyms";

const person = (coachId: string, first: string, isDirector = false): SessionUser => ({
  coachId,
  firstName: first,
  lastName: "X",
  isDirector,
  isCoach: !isDirector,
  requestPending: false,
  hasThunderRole: true,
});
const director = person("9913694", "Earl", true);
const head = person("5550001", "Hal");

describe("Team Practice Facilities", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });

  const now = zonedTime(2026, 11, 9, 12);
  const deps = () => ({ pool: db.pool, now: () => now });
  let rec = "";
  const slot: Record<string, string> = {};

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('9913694','Earl','X','4239913694'), ('5550001','Hal','X','4235550001')`,
    );
    const t = await db.pool.query<{ id: string }>(
      // Teams from before Team Practice Facilities: every gym.
      `insert into teams (name, gender, grades, grade_sort, level, created_by, practice_gyms_set) values
         ('4G A', 'Girls', '{4}', 4, 'REC', 'x', false), ('6B C', 'Boys', '{6}', 6, 'COMP', 'x', false) returning id::text`,
    );
    [rec] = t.rows.map((r) => r.id);
    await db.pool.query(`insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x')`, [rec]);
    for (const name of ["Action Church", "East Ridge MS"]) {
      const g = await db.pool.query<{ id: string }>("insert into gyms (name) values ($1) returning id::text", [name]);
      const c = await db.pool.query<{ id: string }>("insert into courts (gym_id, name) values ($1, 'Goal #1') returning id::text", [g.rows[0].id]);
      const s = await db.pool.query<{ id: string }>(
        "insert into slots (court_id, starts_at, created_by) values ($1, $2, 'x') returning id::text",
        [c.rows[0].id, zonedTime(2026, 11, 12, 18)],
      );
      slot[name] = s.rows[0].id;
    }
  });

  const set = (gym: string, on: boolean, who = director, teamId = rec) => setTeamGym(deps(), who, { teamId, gym, on });

  it("lists teams by Level, Gender and Grade; none set = every gym", async () => {
    const r = await teamGyms(deps(), director);
    expect(r?.gyms).toEqual(["Action Church", "East Ridge MS"]);
    expect(r?.teams.map((t) => [t.name, t.everyGym, t.gyms.length])).toEqual([
      ["6B C", true, 2],
      ["4G A", true, 2],
    ]);
    expect(await teamGyms(deps(), head)).toBeNull();
  });

  it("unchecking keeps the others and records who; none checked = Own gym only", async () => {
    expect(await set("east ridge ms", false)).toEqual({ ok: true });
    const row = (await db.pool.query("select practice_locations, practice_locations_by from teams where id = $1", [rec])).rows[0];
    expect(row).toEqual({ practice_locations: ["Action Church"], practice_locations_by: "Earl X" });
    expect(await set("Action Church", false)).toEqual({ ok: true });
    expect((await teamGyms(deps(), director))?.teams.find((t) => t.id === rec)).toMatchObject({ everyGym: false, gyms: [] });
    expect(await bookSlot(deps(), head, { slotId: slot["Action Church"], teamId: rec })).toMatchObject({ ok: false, message: /practice facilities/ });
    expect(await set("Action Church", true)).toEqual({ ok: true });
    expect(await set("East Ridge MS", true)).toEqual({ ok: true });
    expect((await teamGyms(deps(), director))?.teams.find((t) => t.id === rec)).toMatchObject({ everyGym: false, gyms: ["Action Church", "East Ridge MS"] });
  });

  it("a new team starts with no gyms until a Director checks one", async () => {
    const n = await db.pool.query<{ id: string }>(
      "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('3G N', 'Girls', '{3}', 3, 'REC', 'x') returning id::text",
    );
    const id = n.rows[0].id;
    await db.pool.query(`insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x')`, [id]);
    expect((await teamGyms(deps(), director))?.teams.find((t) => t.id === id)).toMatchObject({ everyGym: false, gyms: [] });
    expect(await bookSlot(deps(), head, { slotId: slot["Action Church"], teamId: id })).toMatchObject({ ok: false, message: /practice facilities/ });
    expect(await set("Action Church", true, director, id)).toEqual({ ok: true });
    expect(await bookSlot(deps(), head, { slotId: slot["Action Church"], teamId: id })).toMatchObject({ ok: true });
  });

  it("only Directors of Facilities or Practices can set it; unknown gyms are refused", async () => {
    expect(await set("East Ridge MS", false, head)).toMatchObject({ ok: false });
    expect(await set("Nowhere Gym", false)).toMatchObject({ ok: false, message: /no longer exists/ });
  });

  it("a coach can't book an unchecked gym; the Director's own grid still can", async () => {
    await set("East Ridge MS", false);
    expect(await bookSlot(deps(), head, { slotId: slot["East Ridge MS"], teamId: rec })).toMatchObject({ ok: false, message: /practice facilities/ });
    expect(await bookSlot(deps(), head, { slotId: slot["Action Church"], teamId: rec })).toMatchObject({ ok: true });
    expect(await bookSlot(deps(), director, { slotId: slot["East Ridge MS"], teamId: rec })).toMatchObject({ ok: true });
  });
});
