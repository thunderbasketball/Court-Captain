import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addPlayer, removeAddedPlayer, type AddedPlayerInput } from "./added-players";
import { parseCsv } from "./csv";
import { HEADER, row } from "./teamsnap/fixtures";
import { syncRegistrations } from "./teamsnap/sync";
import { createTestDb } from "./testing/db";

const director = (areas: SessionUser["thunderAreas"]): SessionUser => ({
  coachId: "5550001",
  firstName: "Pat",
  lastName: "Lee",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: true,
  thunderAreas: areas,
});
const playersDirector = director(["players"]);
const NOW = new Date("2026-11-03T15:00:00Z");
const input = (more: Partial<AddedPlayerInput> = {}): AddedPlayerInput => ({
  first: "Ava",
  last: "Stone",
  gender: "Girls",
  grade: "5",
  birthdate: "2015-04-02",
  parentFirst: "Kim",
  parentLast: "Stone",
  parentCell: "(423) 555-0199",
  parentEmail: "",
  uniformSize: "YL",
  waive: true,
  fee: "",
  notes: "Scholarship",
  ...more,
});

describe("players added in the app", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => NOW });
  beforeEach(async () => {
    await db.reset();
  });
  const row1 = async (id: string) =>
    (
      await db.pool.query(
        `select first_name, gender, grade, grade_sort, program, parent1_cell, uniform_needed, uniform_size, total_fees::float8,
                amount_remaining::float8, added_by, fees_waived_by, notes from registrations where registrant_id = $1`,
        [id],
      )
    ).rows[0];

  it("Owners, Admins and Directors of Players add a player with fees waived (or a fee); checked; no duplicates", async () => {
    expect(await addPlayer(deps(), director(["teams"]), input())).toMatchObject({ ok: false }); // Director of Teams: no
    expect(await addPlayer(deps(), { ...playersDirector, isDirector: false }, input())).toMatchObject({ ok: false });
    expect(await addPlayer(deps(), playersDirector, input({ first: "=cmd" }))).toMatchObject({ ok: false });
    expect(await addPlayer(deps(), playersDirector, input({ grade: "13" }))).toMatchObject({ ok: false });
    expect(await addPlayer(deps(), playersDirector, input({ parentCell: "555" }))).toMatchObject({ ok: false });
    expect(await addPlayer(deps(), playersDirector, input({ birthdate: "2030-01-01" }))).toMatchObject({ ok: false });

    const a = await addPlayer(deps(), playersDirector, input());
    expect(a).toEqual({ ok: true, id: "app-1" });
    expect(await row1("app-1")).toEqual({
      first_name: "Ava",
      gender: "Girls",
      grade: "5",
      grade_sort: 5,
      program: "5th Girls",
      parent1_cell: "4235550199",
      uniform_needed: true,
      uniform_size: "YL",
      total_fees: null,
      amount_remaining: null,
      added_by: "Pat Lee",
      fees_waived_by: "Pat Lee",
      notes: ["Scholarship"],
    });
    expect(await addPlayer(deps(), playersDirector, input())).toEqual({ ok: false, message: "Ava Stone is already registered." });

    const b = await addPlayer(
      deps(),
      director(undefined),
      input({ first: "Ben", gender: "Boys", grade: "K", waive: false, fee: "$150" }),
    );
    expect(b).toEqual({ ok: true, id: "app-2" });
    expect(await row1("app-2")).toMatchObject({
      program: "Kindergarten Boys",
      grade_sort: 0,
      total_fees: 150,
      amount_remaining: 150,
      fees_waived_by: null,
    });
  });

  it("the sheet sync (and any bulk delete) keeps them; removing one is on purpose, and not while on a team", async () => {
    const added = await addPlayer(deps(), playersDirector, input());
    if (!added.ok) throw new Error(added.message);
    const id = added.id;
    const sync = (n: number) =>
      syncRegistrations({
        pool: db.pool,
        now: () => NOW,
        readRows: async () =>
          parseCsv([HEADER, ...Array.from({ length: n }, (_, i) => row({ rid: String(i + 1), first: `S${n}` }))].join("\n")),
      });
    expect(await sync(2)).toMatchObject({ status: "updated", imported: 2 });
    expect(await sync(3)).toMatchObject({ status: "updated", imported: 3 });
    const all = async () =>
      (await db.pool.query("select registrant_id from registrations order by registrant_id")).rows.map((r) => r.registrant_id);
    expect(await all()).toEqual(["1", "2", "3", id]);
    await db.pool.query("delete from registrations"); // what the older sync did
    expect(await all()).toEqual([id]);

    const t = (
      await db.pool.query<{ id: string }>(
        "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('5G Stone', 'Girls', '{5}', 5, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       values ($1, $2, 'Ava', 'Stone', 'Girls', '5', 5, 'x', now())`,
      [t, id],
    );
    expect(await removeAddedPlayer(deps(), playersDirector, id)).toEqual({
      ok: false,
      message: "Take Ava Stone off 5G Stone first.",
    });
    await db.pool.query("delete from team_players");
    expect(await removeAddedPlayer(deps(), director(["teams"]), id)).toMatchObject({ ok: false });
    expect(await removeAddedPlayer(deps(), playersDirector, "1")).toMatchObject({ ok: false }); // TeamSnap's: no
    expect(await removeAddedPlayer(deps(), playersDirector, id)).toEqual({ ok: true });
    expect(await all()).toEqual([]);
  });
});
