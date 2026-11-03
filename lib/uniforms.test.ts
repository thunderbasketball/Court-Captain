import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addPlayers } from "./rosters";
import { createTestDb } from "./testing/db";
import {
  duplicateNumbers,
  isMissing,
  listUniformOrders,
  listUniforms,
  markUniformAdded,
  saveUniform,
  setNeedsUniform,
  uniformRequests,
  uniformsMissing,
} from "./uniforms";

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
const parent = person("5550001", "Tess"); // Team Parent on the team
const stranger = person("5550002", "Amy");

describe("uniforms", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-10-30T12:00:00Z") });
  let team = "";

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Tess', 'X', '4235550001'), ('5550002', 'Amy', 'X', '4235550002')`,
    );
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x') returning id::text`,
    );
    team = t.rows[0].id;
    await db.pool.query(`insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'TeamParent', 'x')`, [
      team,
    ]);
    for (const [id, first, last, needed, size, num] of [
      ["r1", "Ava", "Zed", true, "YM", "9"],
      ["r2", "Bea", "Young", false, "YL", "12"],
      ["r3", "Cy", "Xu", true, null, null],
    ] as const) {
      await db.pool.query(
        `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw,
                                    imported_at, imported_by, uniform_needed, uniform_size, uniform_number)
         values ($1, $1, $2, $3, 'Girls', '4', 4, 'x', '{}', now(), 'x', $4, $5, $6)`,
        [id, first, last, needed, size, num],
      );
    }
    await addPlayers(deps(), director, team, ["r1", "r2", "r3"]);
  });

  it("lists the roster with what was ordered; the parent's request is only a hint", async () => {
    const rows = await listUniforms(deps(), parent, team);
    expect(rows?.map((r) => [r.firstName, r.ordered, r.askedSize, r.askedNumber, r.number])).toEqual([
      ["Cy", true, null, null, null],
      ["Bea", false, "YL", "12", null],
      ["Ava", true, "YM", "9", null],
    ]);
    expect(await uniformsMissing(deps(), team)).toBe(3);
    expect(await listUniforms(deps(), stranger, team)).toBeNull();
  });

  it("needs a number for everyone and a size for those who ordered; who set it is recorded", async () => {
    expect(await saveUniform(deps(), parent, team, "r2", { number: "12" })).toMatchObject({ ok: true, updatedBy: "Tess X" });
    expect(await saveUniform(deps(), parent, team, "r1", { number: "9" })).toMatchObject({ ok: true });
    expect(await uniformsMissing(deps(), team)).toBe(2); // Ava still needs a size, Cy everything
    expect(await saveUniform(deps(), director, team, "r1", { size: "YM" })).toMatchObject({ ok: true, updatedBy: "Earl X" });
    const ava = (await listUniforms(deps(), parent, team))!.find((r) => r.registrantId === "r1")!;
    expect(ava).toMatchObject({ number: "9", size: "YM", updatedBy: "Earl X" }); // saving the size kept the number
    expect(isMissing(ava)).toBe(false);
    expect(await uniformsMissing(deps(), team)).toBe(1);
    expect(await saveUniform(deps(), parent, team, "r1", { size: null })).toMatchObject({ ok: true });
    expect(await uniformsMissing(deps(), team)).toBe(2);
  });

  it("a duplicate number is allowed but reported", async () => {
    await saveUniform(deps(), parent, team, "r1", { number: "5" });
    expect(await saveUniform(deps(), parent, team, "r2", { number: "5" })).toMatchObject({ ok: true, duplicates: ["5"] });
    expect(duplicateNumbers((await listUniforms(deps(), parent, team))!)).toEqual(new Set(["5"]));
    expect(await saveUniform(deps(), parent, team, "r2", { number: "6" })).toMatchObject({ ok: true, duplicates: [] });
    expect(await saveUniform(deps(), parent, team, "r2", { number: "05" })).toMatchObject({ ok: true, duplicates: ["5"] }); // 05 is #5
    expect(await saveUniform(deps(), parent, team, "r2", { number: "00" })).toMatchObject({ ok: true, duplicates: [] });
    await saveUniform(deps(), parent, team, "r3", { number: "0" });
    expect(duplicateNumbers((await listUniforms(deps(), parent, team))!)).toEqual(new Set()); // 0 and 00 differ
  });

  it("Directors see every uniform ordered, with its number and size", async () => {
    await saveUniform(deps(), parent, team, "r1", { number: "9", size: "AXS" });
    expect((await listUniformOrders(deps(), director)).map((r) => [r.team, r.lastName, r.number, r.size])).toEqual([
      ["4G A", "Xu", null, null],
      ["4G A", "Zed", "9", "AXS"],
    ]); // Bea didn't order one
    await expect(listUniformOrders(deps(), parent)).rejects.toThrow();
  });

  it("checks every value and who's asking", async () => {
    expect(await saveUniform(deps(), parent, team, "r1", { number: "100" })).toMatchObject({ ok: false });
    expect(await saveUniform(deps(), parent, team, "r1", { number: "=1+1" })).toMatchObject({ ok: false });
    expect(await saveUniform(deps(), parent, team, "r1", { size: "Huge" })).toMatchObject({ ok: false });
    expect(await saveUniform(deps(), parent, team, "r1", { size: "A2XL" })).toMatchObject({ ok: false });
    expect(await saveUniform(deps(), parent, team, "nobody", { number: "1" })).toMatchObject({ ok: false });
    expect(await saveUniform(deps(), stranger, team, "r1", { number: "1" })).toMatchObject({ ok: false });
    expect(await saveUniform(deps(), parent, team, "r1", {})).toMatchObject({ ok: false });
  });

  it("a coach ticks Needs a uniform; it's listed on Home to add to the TeamSnap order until marked Added", async () => {
    // Bea's family didn't order one: she needs only a number until her coach ticks the box.
    await saveUniform(deps(), parent, team, "r2", { number: "12" });
    expect(await uniformsMissing(deps(), team)).toBe(2); // Ava (no number) and Cy (no number or size)
    expect(await setNeedsUniform(deps(), stranger, team, "r2", true)).toMatchObject({ ok: false });
    expect(await setNeedsUniform(deps(), parent, team, "r1", true)).toEqual({
      ok: false,
      message: "Their family already ordered a uniform.",
    });
    expect(await setNeedsUniform(deps(), parent, team, "r2", true)).toEqual({ ok: true, by: "Tess X" });
    const bea = async () => (await listUniforms(deps(), parent, team))!.find((r) => r.registrantId === "r2")!;
    expect(await bea()).toMatchObject({
      ordered: true,
      registered: false,
      neededBy: "Tess X",
      addedBy: null,
      number: "12",
      late: true,
    });
    expect((await listUniforms(deps(), parent, team))!.find((r) => r.registrantId === "r1")!.late).toBe(false); // ordered at registration
    expect(await uniformsMissing(deps(), team)).toBe(3); // now Bea needs a size too
    expect((await listUniformOrders(deps(), director)).map((o) => o.lastName)).toContain("Young");

    // Home: Directors of Uniforms only. Added needs a size first.
    expect(await uniformRequests(deps(), parent)).toBeNull();
    expect((await uniformRequests(deps(), director))!.map((r) => [r.firstName, r.team, r.size, r.neededBy])).toEqual([
      ["Bea", "4G A", null, "Tess X"],
    ]);
    expect(await markUniformAdded(deps(), director, team, "r2")).toMatchObject({ ok: false, message: /size first/ });
    await saveUniform(deps(), parent, team, "r2", { size: "YL" });
    expect(await markUniformAdded(deps(), parent, team, "r2")).toMatchObject({ ok: false });
    expect(await markUniformAdded(deps(), director, team, "r2")).toEqual({ ok: true });
    expect(await uniformRequests(deps(), director)).toEqual([]);
    expect(await bea()).toMatchObject({ ordered: true, addedBy: "Earl X", size: "YL" });

    // Once on the order, only a Director of Uniforms can untick it; unticking clears the size.
    expect(await setNeedsUniform(deps(), parent, team, "r2", false)).toMatchObject({
      ok: false,
      message: /already on the TeamSnap order/,
    });
    expect(await setNeedsUniform(deps(), director, team, "r2", false)).toMatchObject({ ok: true });
    expect(await bea()).toMatchObject({ ordered: false, neededBy: null, addedBy: null, size: null, number: "12" });

    // The sheet showing the order takes them off the list too.
    await setNeedsUniform(deps(), parent, team, "r2", true);
    await db.pool.query("update registrations set uniform_needed = true where registrant_id = 'r2'");
    expect(await uniformRequests(deps(), director)).toEqual([]);
    // The Uniform Fee added to a family that answered NO: ordered, marked ✱ (added after registration).
    await db.pool.query(`update team_uniforms set needs_uniform_at = null, needs_uniform_by = null where registrant_id = 'r2'`);
    await db.pool.query(
      `update registrations set raw = '{"Uniform Needed?": "NO", "NEW Uniform Fee": "Uniform Fee"}' where registrant_id = 'r2'`,
    );
    expect((await listUniformOrders(deps(), director)).map((o) => [o.lastName, o.late])).toContainEqual(["Young", true]);
    expect((await listUniformOrders(deps(), director)).map((o) => [o.lastName, o.late])).toContainEqual(["Zed", false]);
  });
});
