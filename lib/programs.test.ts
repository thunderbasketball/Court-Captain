import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { orgPrograms, stageOf } from "./programs";
import { createTestDb } from "./testing/db";

// Wednesday Nov 11, 2026, noon Eastern.
const NOW = new Date("2026-11-11T17:00:00Z");

describe("programs", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  let league = "";
  let season = "";

  beforeEach(async () => {
    await db.reset();
    league = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter League', '2026-12-05', '2027-02-27', '2026-10-01', '2026-11-20', 'x', 'x') returning id::text`,
      )
    ).rows[0].id;
    season = (
      await db.pool.query<{ id: string }>(
        `insert into player_programs (org, name, reg_opens, season_from, created_by)
         values ('thunder', 'Winter 26/27', '2026-10-02', $1, 'x') returning id::text`,
        [league],
      )
    ).rows[0].id;
  });

  const reg = (id: string) =>
    db.pool.query(
      `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw, imported_at, imported_by)
       values ($1, $1, 'P', $1, 'Boys', '5', 5, '5th Boys', '{}', now(), 'x')`,
      [id],
    );

  it("each organization's programs: a Season with its players and sessions; a League with its teams", async () => {
    await reg("r1"); // the sync inserts without a program: Thunder's current one fills in
    await reg("r2");
    const ev = await db.pool.query<{ id: string }>(
      `insert into events (name, kind, starts_at, genders, grades, created_by, program_id)
       values ('Open Gym 5th Boys', 'Open Gym', '2026-10-29T22:00:00Z', '{Boys}', '{5}', 'x', $1) returning id::text`,
      [season],
    );
    await db.pool.query(
      `insert into event_attendees (event_id, registrant_id, first_name, last_name, gender, grade, grade_sort, status)
       values ($1, 'r1', 'P', 'r1', 'Boys', '5', 5, 'here'), ($1, 'r2', 'P', 'r2', 'Boys', '5', 5, 'unknown')`,
      [ev.rows[0].id],
    );

    const t = await orgPrograms(db.pool, "thunder", NOW);
    expect(t).toEqual([
      expect.objectContaining({
        id: season,
        takes: "players",
        kind: "Season",
        name: "Winter 26/27",
        regOpens: "2026-10-02",
        regCloses: null,
        startsOn: "2026-12-05", // from the League
        endsOn: "2027-02-27",
        seasonFrom: "Winter League",
        registered: 2,
        stage: "open",
        sessions: [expect.objectContaining({ kind: "Open Gym", name: "Open Gym 5th Boys", expected: 2, here: 1 })],
      }),
    ]);
    const s = await orgPrograms(db.pool, "scenic-city", NOW);
    expect(s).toEqual([
      expect.objectContaining({ id: league, takes: "teams", kind: "League", registered: 0, sessions: [], stage: "open" }),
    ]);
    expect(await orgPrograms(db.pool, "east-ridge", NOW)).toEqual([]);
  });

  it("where a program stands", () => {
    const p = { regOpens: "2026-10-01", regCloses: "2026-11-20", startsOn: "2026-12-05", endsOn: "2027-02-27" };
    expect(stageOf(p, "2026-09-30")).toBe("upcoming");
    expect(stageOf(p, "2026-11-20")).toBe("open");
    expect(stageOf(p, "2026-11-25")).toBe("upcoming"); // closed, season not started
    expect(stageOf(p, "2026-12-05")).toBe("running");
    expect(stageOf(p, "2027-02-28")).toBe("ended");
    expect(stageOf({ ...p, regCloses: null }, "2027-01-10")).toBe("open"); // open until the season ends
  });
});
