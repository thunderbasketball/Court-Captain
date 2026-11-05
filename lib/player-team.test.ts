import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { playerTeam } from "./player-team";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, isDirector: boolean): SessionUser => ({
  coachId,
  firstName: "X",
  lastName: "X",
  isDirector,
  isCoach: !isDirector,
  requestPending: false,
  hasThunderRole: true,
});
const dir = person("9913694", true);
const coach = person("5550001", false);

describe("player team", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  const now = new Date("2026-11-10T12:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('9913694', 'Dee', 'X', '4239913694'), ('5550001', 'Cal', 'Coach', '4235550001')`,
    );
    await grant(db.pool, "9913694 thunder Director", "5550001 thunder Coach");
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Coach', 'Girls', '{4}', 4, 'REC', 'x') returning id::text`,
    );
    const team = t.rows[0].id;
    await db.pool.query(`insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x')`, [
      team,
    ]);
    await db.pool.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       values ($1, 'R1', 'Amy', 'P', 'Girls', '4', 4, 'Dee X', now())`,
      [team],
    );
    const g = await db.pool.query<{ id: string }>("insert into gyms (name) values ('Action Church') returning id::text");
    const c = await db.pool.query<{ id: string }>("insert into courts (gym_id, name) values ($1, 'North') returning id::text", [
      g.rows[0].id,
    ]);
    await db.pool.query(
      `insert into slots (court_id, starts_at, team_id, created_by) values
         ($1, '2026-11-03T23:00:00Z', $2, 'x'), ($1, '2026-11-17T23:00:00Z', $2, 'x'), ($1, '2026-11-24T23:00:00Z', null, 'x')`,
      [c.rows[0].id, team],
    );
  });

  it("shows the player's team, its staff and upcoming practices only", async () => {
    const r = await playerTeam(deps(), dir, "R1");
    // A Director (not an Admin) doesn't see who rostered the player; an Owner or Admin does.
    expect(r).toMatchObject({
      name: "4G Coach",
      level: "REC",
      rosteredBy: null,
      staff: [{ role: "HeadCoach", name: "Cal Coach" }],
    });
    await grant(db.pool, "9913694 thunder Admin");
    expect(await playerTeam(deps(), dir, "R1")).toMatchObject({ rosteredBy: "Dee X" });
    expect(r?.practices).toHaveLength(1); // the past one and the open slot are left out
    expect(r?.practices[0]).toMatchObject({ gym: "Action Church", court: "North" });
  });

  it("no team → null; Directors only; junk ids refused", async () => {
    expect(await playerTeam(deps(), dir, "R2")).toBeNull();
    expect(await playerTeam(deps(), dir, "R1'; drop table teams")).toBeNull();
    await expect(playerTeam(deps(), coach, "R1")).rejects.toThrow();
  });
});
