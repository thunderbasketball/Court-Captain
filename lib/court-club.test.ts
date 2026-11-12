import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clubActiveDays, setClubActiveDays } from "./court-club";
import { createTestDb } from "./testing/db";

const al = { coachId: "5550001", firstName: "Al", lastName: "X" } as never;
const di = { coachId: "5550002", firstName: "Di", lastName: "X" } as never;

describe("CourtClub settings", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Al', 'X', '4235550001'), ('5550002', 'Di', 'X', '4235550002')`,
    );
    await db.pool.query("select set_role('5550001', 'thunder', 'Admin', true, 'test'), set_role('5550002', 'thunder', 'Director', true, 'test')");
  });

  it("30 days until set; only an Admin sets 1–365 (CourtClub comes with every organization)", async () => {
    expect(await clubActiveDays(db.pool, "thunder")).toBe(30);
    expect(await setClubActiveDays({ pool: db.pool }, di, "thunder", 45)).toMatchObject({ ok: false }); // not an Admin
    expect(await setClubActiveDays({ pool: db.pool }, al, "thunder", 0)).toMatchObject({ ok: false });
    expect(await setClubActiveDays({ pool: db.pool }, al, "thunder", "45")).toMatchObject({ ok: false });
    expect(await setClubActiveDays({ pool: db.pool }, al, "thunder", 45)).toEqual({ ok: true });
    expect(await clubActiveDays(db.pool, "thunder")).toBe(45);
  });
});
