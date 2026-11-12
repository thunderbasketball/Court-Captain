import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { parseCsv } from "./csv";
import { birthdateFixes, fixBirthdate } from "./birthdate-fix";
import { createTestDb } from "./testing/db";
import { HEADER, row } from "./teamsnap/fixtures";
import { syncRegistrations } from "./teamsnap/sync";

const director = { coachId: "9913694", firstName: "Earl", lastName: "Epps", isDirector: true } as SessionUser; // every area
const teamsOnly = { ...director, thunderAreas: ["teams"] } as SessionUser;
const sheet = (birthdate: string) => parseCsv([HEADER, row({ rid: "1", birthdate }), row({ rid: "2" })].join("\n"));

describe("fixing a birthday in the app", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  beforeEach(async () => db.reset());
  let t = new Date("2026-11-11T17:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => t });
  const sync = (rows: string[][]) => syncRegistrations({ ...deps(), readRows: async () => rows });
  const born = async () =>
    (await db.pool.query("select to_char(birthdate, 'YYYY-MM-DD') as d from registrations where registrant_id = '1'")).rows[0].d;

  it("stays fixed through sheet syncs, until TeamSnap says the same; only Directors of Players; checks the date", async () => {
    await sync(sheet("08-07-1997 8:00:00 PM")); // TeamSnap's evening time: the next day
    expect(await born()).toBe("1997-08-08");
    expect(await fixBirthdate(deps(), teamsOnly, "1", "2017-08-08")).toMatchObject({ ok: false });
    expect(await fixBirthdate(deps(), director, "1", "2027-01-01")).toMatchObject({ ok: false }); // not born yet
    expect(await fixBirthdate(deps(), director, "1", "1990-01-01")).toMatchObject({ ok: false });
    expect(await fixBirthdate(deps(), director, "nobody", "2017-08-08")).toMatchObject({ ok: false });
    expect(await fixBirthdate(deps(), director, "1", "2017-08-08")).toEqual({ ok: true });
    expect(await born()).toBe("2017-08-08");
    expect((await birthdateFixes(db.pool)).get("1")).toEqual({ setBy: "Earl Epps", sheetBirthdate: "1997-08-08" });

    // The sheet changes (another player), and the sync replaces everything: the fix is put back.
    t = new Date("2026-11-11T17:10:00Z");
    await sync(parseCsv([HEADER, row({ rid: "1", birthdate: "08-07-1997 8:00:00 PM" }), row({ rid: "2", first: "Ann" })].join("\n")));
    expect(await born()).toBe("2017-08-08");
    // Something else put the sheet's date back (an older copy of the app): the next check fixes it again.
    await db.pool.query("update registrations set birthdate = '1997-08-08' where registrant_id = '1'");
    t = new Date("2026-11-11T17:20:00Z");
    await sync(parseCsv([HEADER, row({ rid: "1", birthdate: "08-07-1997 8:00:00 PM" }), row({ rid: "2", first: "Ann" })].join("\n")));
    expect(await born()).toBe("2017-08-08");

    // Use TeamSnap's: back to the sheet's date, fix gone.
    expect(await fixBirthdate(deps(), director, "1", null)).toEqual({ ok: true });
    expect(await born()).toBe("1997-08-08");
    expect((await birthdateFixes(db.pool)).size).toBe(0);

    // Fixed again, then TeamSnap is corrected to the same date: the fix is dropped.
    await fixBirthdate(deps(), director, "1", "2017-08-08");
    await sync(sheet("08-07-2017 8:00:00 PM"));
    expect(await born()).toBe("2017-08-08");
    expect((await birthdateFixes(db.pool)).size).toBe(0);
  });
});
