import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseCsv } from "../csv";
import { createTestDb } from "../testing/db";
import { HEADER, row } from "./fixtures";
import { importRegistrations } from "./import";
import { parseRegistrations } from "./parse";
import { AUTO_IMPORTED_BY, getSyncStatus, syncRegistrations } from "./sync";

const sheet = (...rows: string[]) => parseCsv([HEADER, ...rows].join("\n"));
const players = (n: number, first = "Sam") => Array.from({ length: n }, (_, i) => row({ rid: String(i + 1), first }));

describe("syncRegistrations", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  beforeEach(async () => {
    await db.reset();
  });

  let t = new Date("2026-10-27T12:00:00Z");
  const now = () => t;
  const sync = (rows: string[][] | Error) =>
    syncRegistrations({
      pool: db.pool,
      now,
      readRows: async () => {
        if (rows instanceof Error) throw rows;
        return rows;
      },
    });
  const names = async () =>
    (await db.pool.query("select first_name, imported_by from registrations order by registrant_id")).rows;

  it("loads the sheet, then skips when nothing changed", async () => {
    expect(await sync(sheet(...players(2)))).toEqual({ status: "updated", imported: 2 });
    expect(await names()).toEqual([
      { first_name: "Sam", imported_by: AUTO_IMPORTED_BY },
      { first_name: "Sam", imported_by: AUTO_IMPORTED_BY },
    ]);

    t = new Date("2026-10-27T12:10:00Z");
    expect(await sync(sheet(...players(2)))).toEqual({ status: "unchanged" });
    const s = await getSyncStatus(db.pool);
    expect(s).toMatchObject({ ok: true, message: null, checkedAt: t, changedAt: new Date("2026-10-27T12:00:00Z") });
  });

  it("picks up changes to the sheet", async () => {
    await sync(sheet(...players(2)));
    expect(await sync(sheet(...players(3, "Ann")))).toEqual({ status: "updated", imported: 3 });
    expect((await names()).map((r) => r.first_name)).toEqual(["Ann", "Ann", "Ann"]);
  });

  it("a player no longer in registrations comes off their team", async () => {
    await sync(sheet(...players(2)));
    const team = (
      await db.pool.query(
        "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G X', 'Girls', '{4}', 4, 'REC', 'x') returning id",
      )
    ).rows[0].id;
    for (const id of ["1", "2"]) {
      await db.pool.query(
        `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
         values ($1, $2, 'Sam', 'X', 'Girls', '4', 4, 'x', now())`,
        [team, id],
      );
      await db.pool.query(
        "insert into team_uniforms (team_id, registrant_id, number, updated_by, updated_at) values ($1, $2, '1', 'x', now())",
        [team, id],
      );
    }
    await sync(sheet(row({ rid: "1", first: "Ann" }), row({ rid: "3", first: "Ann" })));
    expect((await db.pool.query("select registrant_id from team_players")).rows).toEqual([{ registrant_id: "1" }]);
    expect((await db.pool.query("select registrant_id from team_uniforms")).rows).toEqual([{ registrant_id: "1" }]);
  });

  it("a sheet with errors changes nothing and is reported", async () => {
    await sync(sheet(...players(2)));
    const r = await sync(sheet(row({ rid: "9" }), row({ rid: "9" })));
    expect(r).toMatchObject({ status: "failed", message: expect.stringMatching(/1 error.*appears twice/) });
    expect(await names()).toHaveLength(2);
    expect(await getSyncStatus(db.pool)).toMatchObject({ ok: false });
  });

  it("refuses a sheet that lost more than half the players", async () => {
    await sync(sheet(...players(10)));
    const r = await sync(sheet(...players(4)));
    expect(r).toMatchObject({ status: "failed", message: expect.stringMatching(/4 players but the app has 10/) });
    expect(await names()).toHaveLength(10);
  });

  it("an empty tab changes nothing", async () => {
    await sync(sheet(...players(2)));
    expect(await sync([])).toMatchObject({ status: "failed" });
    expect(await names()).toHaveLength(2);
  });

  it("a Google error is recorded and the list is kept", async () => {
    await sync(sheet(...players(2)));
    const r = await sync(new Error("Can't open that sheet."));
    expect(r).toEqual({ status: "failed", message: "Can't open that sheet." });
    expect(await getSyncStatus(db.pool)).toMatchObject({ ok: false, message: "Can't open that sheet." });
    expect(await names()).toHaveLength(2);
  });

  it("after a hand import, the next sync re-applies the sheet", async () => {
    await sync(sheet(...players(2)));
    const csv = parseRegistrations([HEADER, row({ rid: "50", first: "Hand" })].join("\n"), { schoolYear: 2026 });
    await importRegistrations(db.pool, csv, "Earl Epps", now());
    expect(await sync(sheet(...players(2)))).toEqual({ status: "updated", imported: 2 });
  });
});
