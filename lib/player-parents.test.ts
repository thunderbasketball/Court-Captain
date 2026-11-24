import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parentEmailIssue, type SessionUser } from "./auth/service";
import { parseCsv } from "./csv";
import { parentSlots, saveParent, undoParent } from "./player-parents";
import { createTestDb } from "./testing/db";
import { HEADER, row } from "./teamsnap/fixtures";
import { syncRegistrations } from "./teamsnap/sync";

const director = { coachId: "9913694", firstName: "Earl", lastName: "Epps", isDirector: true } as SessionUser; // every area
const staff = (coachId: string, firstName: string) => ({ coachId, firstName, lastName: "X", isDirector: false }) as SessionUser;
const pat = staff("5550201", "Pat"); // Team Parent of player 1's team
const nat = staff("5550202", "Nat"); // nobody

describe("a player's parents, added or fixed in the app", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  it("the team's staff add a missing one, Directors change any; kept through sheet syncs; the parent verifies that email", async () => {
    let t = new Date("2026-11-24T17:00:00Z");
    const deps = { pool: db.pool, now: () => t };
    const sync = async (changed: string) => {
      t = new Date(t.getTime() + 600_000);
      await syncRegistrations({ ...deps, readRows: async () => parseCsv([HEADER, row({ rid: "1" }), row({ rid: "2", first: changed })].join("\n")) });
    };
    await sync("Ann");
    await db.pool.query(
      `update registrations set parent1_first = 'Pam', parent1_last = 'One', parent1_cell = '4235550001', parent1_email = 'pam@example.com',
              parent2_first = null, parent2_last = null, parent2_cell = null, parent2_email = null`,
    );
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Earl', 'Epps', '4239913694'), ('5550201', 'Pat', 'X', '4235550201'), ('5550202', 'Nat', 'X', '4235550202')`,
    );
    const team = (await db.pool.query<{ id: string }>("insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4B Test', 'Boys', '{4}', 4, 'REC', 't') returning id::text")).rows[0].id;
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550201', 'TeamParent', 't')", [team]);
    await db.pool.query(
      "insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at) select $1, registrant_id, first_name, last_name, gender, grade, grade_sort, 't', now() from registrations where registrant_id = '1'",
      [team],
    );
    const slots = async (who: SessionUser, id = "1") => (await parentSlots(db.pool, who, [id])).get(id);
    const dad = { first: "Dan", last: "Two", cell: "(423) 555-0002", email: "Dan@Example.com" };

    // Not their team: nothing shown, nothing changed.
    expect(await slots(nat)).toBeUndefined();
    expect(await saveParent(deps, nat, "1", 2, dad)).toMatchObject({ ok: false });
    expect(await saveParent(deps, pat, "2", 2, dad)).toMatchObject({ ok: false });
    expect((await slots(pat))!.map((s) => s.canEdit)).toEqual([false, true]); // the 1st came with the registration
    // The team's staff: not the registration's parent, themself, a parent's cell from another family, or bad input.
    expect(await saveParent(deps, pat, "1", 1, { first: "Pam", last: "One", cell: "4235550001", email: "evil@example.com" })).toMatchObject({ ok: false });
    expect(await saveParent(deps, pat, "1", 2, { ...dad, cell: "4235550201" })).toEqual({ ok: false, message: "Ask a Director to add you as a parent." });
    await db.pool.query("update registrations set parent2_cell = '4235550009', parent2_email = 'zed@example.com' where registrant_id = '2'");
    expect(await saveParent(deps, pat, "1", 2, { ...dad, cell: "4235550009" })).toMatchObject({ ok: false });
    expect(await saveParent(deps, pat, "1", 2, { ...dad, cell: "4235550001" })).toMatchObject({ ok: false }); // the other parent's cell
    expect(await saveParent(deps, pat, "1", 2, { ...dad, first: "=Dan" })).toMatchObject({ ok: false });
    expect(await saveParent(deps, pat, "1", 2, { ...dad, email: "nope" })).toMatchObject({ ok: false });
    expect(await saveParent(deps, pat, "1", 3, dad)).toMatchObject({ ok: false });
    expect(await saveParent(deps, pat, "1", 2, dad)).toEqual({ ok: true });
    expect((await slots(director))![1]).toMatchObject({ first: "Dan", cell: "4235550002", email: "dan@example.com", setBy: "Pat X", canUndo: true });
    // They sign up with that email only.
    expect(await parentEmailIssue(db.pool, "4235550002", "dan@example.com")).toBeNull();
    expect(await parentEmailIssue(db.pool, "4235550002", "other@example.com")).not.toBeNull();

    // A sheet change replaces registrations: still there. Whoever added them fixes their own typo; a Director changes any.
    await sync("Bea");
    expect((await slots(director))![1]).toMatchObject({ first: "Dan", cell: "4235550002" });
    expect(await saveParent(deps, pat, "1", 2, { ...dad, last: "Too" })).toEqual({ ok: true });
    expect(await saveParent(deps, director, "1", 1, { first: "Pamela", last: "One", cell: "4235550003", email: "" })).toEqual({ ok: true });
    await sync("Cat");
    expect((await slots(director))!.map((s) => [s.first, s.last, s.cell, s.email])).toEqual([
      ["Pamela", "One", "4235550003", null],
      ["Dan", "Too", "4235550002", "dan@example.com"],
    ]);

    // Undo: not by someone else; back to the registration.
    expect(await undoParent(deps, pat, "1", 1)).toMatchObject({ ok: false });
    expect(await undoParent(deps, pat, "1", 2)).toEqual({ ok: true });
    expect(await undoParent(deps, director, "1", 1)).toEqual({ ok: true });
    expect((await db.pool.query("select 1 from player_parents")).rowCount).toBe(0);
    expect((await slots(director))![0].cell).not.toBe("4235550003");
  }, 120_000);
});
