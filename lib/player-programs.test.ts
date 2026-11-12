import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deletePlayerProgram, playerProgramFields, savePlayerProgram, seasonSources } from "./player-programs";
import { orgPrograms } from "./programs";
import { createTestDb } from "./testing/db";

const NOW = new Date("2026-11-11T17:00:00Z");
const al = { coachId: "5550001", firstName: "Al", lastName: "X" } as never;
const di = { coachId: "5550002", firstName: "Di", lastName: "X" } as never;

describe("player programs", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => NOW });
  let league = "";
  const base = { name: "Spring 2027", regOpens: "2027-01-05", regCloses: "", payOpens: "", payCloses: "", seasonFrom: "", startsOn: "2027-03-01", endsOn: "2027-05-15" };

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Al', 'X', '4235550001'), ('5550002', 'Di', 'X', '4235550002')`,
    );
    await db.pool.query("select set_role('5550001', 'thunder', 'Admin', true, 'test'), set_role('5550002', 'thunder', 'Director', true, 'test')");
    league = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter League', '2026-12-05', '2027-02-27', '2026-10-01', '2026-11-20', 'x', 'x') returning id::text`,
      )
    ).rows[0].id;
  });

  it("Admins (and Directors of Events) add and change a season; dates are checked", async () => {
    expect(await savePlayerProgram(deps(), di, "thunder", null, base)).toMatchObject({ ok: false }); // no Events area
    expect(await savePlayerProgram(deps(), al, "thunder", null, { ...base, name: " " })).toMatchObject({ ok: false });
    expect(await savePlayerProgram(deps(), al, "thunder", null, { ...base, regCloses: "2027-01-01" })).toMatchObject({ ok: false });
    expect(await savePlayerProgram(deps(), al, "thunder", null, { ...base, payOpens: "2027-01-05" })).toMatchObject({ ok: false });
    expect(await savePlayerProgram(deps(), al, "thunder", null, { ...base, endsOn: "2027-02-01" })).toMatchObject({ ok: false });
    const r = await savePlayerProgram(deps(), al, "thunder", null, base);
    expect(r).toMatchObject({ ok: true });
    const id = (r as { id: string }).id;
    expect(await savePlayerProgram(deps(), al, "thunder", null, base)).toMatchObject({ ok: false, message: expect.stringContaining("already") });

    // Season from the League instead, with payment dates.
    expect(
      await savePlayerProgram(deps(), al, "thunder", id, { ...base, seasonFrom: league, startsOn: "", endsOn: "", payOpens: "2027-01-05", payCloses: "2027-02-01" }),
    ).toEqual({ ok: true, id });
    expect(await playerProgramFields(db.pool, "thunder", id)).toMatchObject({ seasonFrom: league, startsOn: "", payCloses: "2027-02-01" });
    expect((await orgPrograms(db.pool, "thunder", NOW))[0]).toMatchObject({ name: "Spring 2027", startsOn: "2026-12-05", seasonFrom: "Winter League" });
    expect(await playerProgramFields(db.pool, "east-ridge", id)).toBeNull(); // another organization's
    expect((await seasonSources(db.pool, NOW)).map((s) => s.name)).toEqual(["Winter League"]);
  });

  it("only an empty program can be deleted", async () => {
    const id = ((await savePlayerProgram(deps(), al, "thunder", null, base)) as { id: string }).id;
    await db.pool.query(
      `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw, imported_at, imported_by, program_id)
       values ('r1', 'r1', 'P', 'K', 'Boys', '5', 5, 'x', '{}', now(), 'x', $1)`,
      [id],
    );
    expect(await deletePlayerProgram(deps(), di, "thunder", id)).toMatchObject({ ok: false }); // not an Admin
    expect(await deletePlayerProgram(deps(), al, "thunder", id)).toMatchObject({ ok: false, message: expect.stringContaining("players") });
    await db.pool.query("delete from registrations");
    expect(await deletePlayerProgram(deps(), al, "thunder", id)).toEqual({ ok: true });
    expect(await playerProgramFields(db.pool, "thunder", id)).toBeNull();
  });
});
