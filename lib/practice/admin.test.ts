import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../auth/service";
import { createTestDb } from "../testing/db";
import { zonedTime } from "../time";
import { addGym, addSlots, blackoutDates, deleteGym } from "./admin";

const director: SessionUser = {
  coachId: "9913694",
  firstName: "Earl",
  lastName: "Epps",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: true,
};
const coach: SessionUser = { ...director, coachId: "5550001", isDirector: false, isCoach: true };

describe("practice admin", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  const now = zonedTime(2026, 10, 28, 12);
  const deps = () => ({ pool: db.pool, now: () => now });
  let gym = "";
  let gym2 = "";
  let north = "";

  beforeEach(async () => {
    await db.reset();
    const a = await addGym(deps(), director, { name: "Action Church", courts: ["North", "South"] });
    const b = await addGym(deps(), director, { name: "Heritage HS", courts: ["Main"] });
    if (!a.ok || !b.ok) throw new Error("setup");
    gym = a.id;
    gym2 = b.id;
    north = (await db.pool.query("select id::text from courts where name = 'North'")).rows[0].id;
  });

  const slots = async () =>
    (
      await db.pool.query(
        `select g.name || ' ' || c.name || ' ' || to_char(s.starts_at at time zone 'America/New_York', 'Dy MM/DD HH24:MI') as at,
                s.blackout, s.note, t.name as team
         from slots s join courts c on c.id = s.court_id join gyms g on g.id = c.gym_id left join teams t on t.id = s.team_id
         order by s.starts_at, g.name, c.name`,
      )
    ).rows;

  it("adds a gym with named courts; refuses duplicates and bad names", async () => {
    expect((await db.pool.query("select name from courts order by name")).rows.map((r) => r.name)).toEqual([
      "Main",
      "North",
      "South",
    ]);
    expect(await addGym(deps(), director, { name: "Action Church", courts: ["Main"] })).toEqual({
      ok: false,
      message: 'There\'s already a gym named "Action Church".',
    });
    expect(await addGym(deps(), director, { name: "New Gym", courts: ["A", "a"] })).toMatchObject({
      ok: false,
      message: /different name/,
    });
    expect(await addGym(deps(), director, { name: "=cmd()", courts: ["A"] })).toMatchObject({ ok: false });
    expect(await addGym(deps(), director, { name: "New Gym", courts: [] })).toMatchObject({ ok: false });
  });

  it("adds slots for chosen courts, days and times; skips ones that exist", async () => {
    // Mon 11/9 to Sun 11/15, Mon + Thu, 6 and 7 PM, all courts at Action Church.
    const input = { gymId: gym, courtId: "all", from: "2026-11-09", to: "2026-11-15", days: [1, 4], hours: [18, 19] };
    expect(await addSlots(deps(), director, input)).toEqual({ ok: true, added: 8, skipped: 0, blocked: 0 });
    expect(await addSlots(deps(), director, input)).toEqual({ ok: true, added: 0, skipped: 8, blocked: 0 });
    expect((await slots()).map((s) => s.at).slice(0, 4)).toEqual([
      "Action Church North Mon 11/09 18:00",
      "Action Church South Mon 11/09 18:00",
      "Action Church North Mon 11/09 19:00",
      "Action Church South Mon 11/09 19:00",
    ]);
    expect(await addSlots(deps(), director, { ...input, courtId: north, days: [2], hours: [18] })).toMatchObject({ added: 1 });
  });

  it("slots added on a blacked-out date come in blocked", async () => {
    await blackoutDates(deps(), director, {
      mode: "block",
      gymId: "all",
      from: "2026-11-26",
      to: "2026-11-26",
      hour: "all",
      reason: "Thanksgiving",
    });
    const r = await addSlots(deps(), director, {
      gymId: gym,
      courtId: north,
      from: "2026-11-23",
      to: "2026-11-27",
      days: [1, 4],
      hours: [18],
    });
    expect(r).toEqual({ ok: true, added: 2, skipped: 0, blocked: 1 });
    expect((await slots()).map((s) => [s.at, s.blackout, s.note])).toEqual([
      ["Action Church North Mon 11/23 18:00", false, null],
      ["Action Church North Thu 11/26 18:00", true, "Thanksgiving"],
    ]);
  });

  it("blocking removes team bookings in range and lists them; past slots are left alone", async () => {
    await addSlots(deps(), director, {
      gymId: gym,
      courtId: "all",
      from: "2026-10-26",
      to: "2026-11-13",
      days: [1, 3],
      hours: [18],
    });
    const t = await db.pool.query<{ id: string }>(
      "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Epps', 'Girls', '{4}', 4, 'REC', 'x') returning id::text",
    );
    await db.pool.query(`update slots set team_id = $1, booked_by = 'Earl Epps' where court_id = $2 and starts_at in ($3, $4)`, [
      t.rows[0].id,
      north,
      zonedTime(2026, 11, 4, 18),
      zonedTime(2026, 10, 26, 18),
    ]);
    const r = await blackoutDates(deps(), director, {
      mode: "block",
      gymId: gym,
      from: "2026-10-26",
      to: "2026-11-05",
      hour: 18,
      reason: "Gym floor refinishing",
    });
    if (!r.ok) throw new Error(r.message);
    expect(r.slots).toBe(6); // Wed 10/28 (later today), Mon 11/2, Wed 11/4 × 2 courts; Mon 10/26 is past
    expect(r.removed.map((x) => [x.team, x.court])).toEqual([["4G Epps", "North"]]);
    const all = await slots();
    expect(all.find((s) => s.at === "Action Church North Mon 10/26 18:00")).toMatchObject({ blackout: false, team: "4G Epps" }); // past: untouched
    expect(all.find((s) => s.at === "Action Church North Wed 11/04 18:00")).toMatchObject({
      blackout: true,
      team: null,
      note: "Gym floor refinishing",
    });
  });

  it("restore reopens slots; restoring one gym of an All Gyms blackout keeps the others blocked", async () => {
    await addGymSlots();
    await blackoutDates(deps(), director, {
      mode: "block",
      gymId: "all",
      from: "2026-11-26",
      to: "2026-11-27",
      hour: "all",
      reason: "Thanksgiving",
    });
    expect((await slots()).every((s) => s.blackout)).toBe(true);
    const r = await blackoutDates(deps(), director, {
      mode: "restore",
      gymId: gym2,
      from: "2026-11-26",
      to: "2026-11-26",
      hour: "all",
      reason: "",
    });
    expect(r).toMatchObject({ ok: true, slots: 1 });
    const after = await slots();
    expect(after.filter((s) => !s.blackout).map((s) => s.at)).toEqual(["Heritage HS Main Thu 11/26 18:00"]);
    // A new slot at Action Church on 11/26 still comes in blocked; Heritage on 11/26 doesn't.
    expect(
      await addSlots(deps(), director, {
        gymId: gym,
        courtId: north,
        from: "2026-11-26",
        to: "2026-11-26",
        days: [4],
        hours: [19],
      }),
    ).toMatchObject({ blocked: 1 });
    expect(
      await addSlots(deps(), director, {
        gymId: gym2,
        courtId: "all",
        from: "2026-11-26",
        to: "2026-11-26",
        days: [4],
        hours: [19],
      }),
    ).toMatchObject({ blocked: 0 });
  });

  it("restoring one time of an All Day blackout keeps the other times blocked", async () => {
    await addSlots(deps(), director, {
      gymId: gym,
      courtId: north,
      from: "2026-11-26",
      to: "2026-11-26",
      days: [4],
      hours: [18, 19],
    });
    await blackoutDates(deps(), director, {
      mode: "block",
      gymId: gym,
      from: "2026-11-26",
      to: "2026-11-26",
      hour: "all",
      reason: "Closed",
    });
    await blackoutDates(deps(), director, {
      mode: "restore",
      gymId: gym,
      from: "2026-11-26",
      to: "2026-11-26",
      hour: 18,
      reason: "",
    });
    expect((await slots()).map((s) => [s.at.slice(-5), s.blackout])).toEqual([
      ["18:00", false],
      ["19:00", true],
    ]);
  });

  it("checks input and Director role", async () => {
    expect(
      await addSlots(deps(), director, {
        gymId: gym,
        courtId: "all",
        from: "2026-11-09",
        to: "2026-11-01",
        days: [1],
        hours: [18],
      }),
    ).toMatchObject({ ok: false, message: /on or after/ });
    expect(
      await addSlots(deps(), director, {
        gymId: gym,
        courtId: "all",
        from: "2026-11-09",
        to: "2026-11-10",
        days: [],
        hours: [18],
      }),
    ).toMatchObject({ ok: false, message: /day/ });
    expect(
      await addSlots(deps(), director, {
        gymId: gym,
        courtId: "all",
        from: "2026-11-09",
        to: "2026-11-10",
        days: [1],
        hours: [3],
      }),
    ).toMatchObject({ ok: false, message: /start time/ });
    expect(
      await addSlots(deps(), director, {
        gymId: gym,
        courtId: "all",
        from: "2026-01-01",
        to: "2028-01-01",
        days: [1],
        hours: [18],
      }),
    ).toMatchObject({ ok: false, message: /year/ });
    expect(await addGym(deps(), coach, { name: "X Gym", courts: ["A"] })).toMatchObject({ ok: false });
    expect(
      await addSlots(deps(), coach, { gymId: gym, courtId: "all", from: "2026-11-09", to: "2026-11-10", days: [1], hours: [18] }),
    ).toMatchObject({ ok: false });
    expect(
      await blackoutDates(deps(), coach, {
        mode: "block",
        gymId: "all",
        from: "2026-11-09",
        to: "2026-11-09",
        hour: "all",
        reason: "",
      }),
    ).toMatchObject({ ok: false });
  });

  async function addGymSlots() {
    await addSlots(deps(), director, {
      gymId: gym,
      courtId: "all",
      from: "2026-11-26",
      to: "2026-11-27",
      days: [4, 5],
      hours: [18],
    });
    await addSlots(deps(), director, {
      gymId: gym2,
      courtId: "all",
      from: "2026-11-26",
      to: "2026-11-26",
      days: [4],
      hours: [18],
    });
  }

  it("deleting a gym: refused with upcoming booked practices; kept (hidden) with past ones; gone otherwise; re-adding brings it back", async () => {
    const a = (await addGym(deps(), director, { name: "Old Gym", courts: ["Main"] })) as { id: string };
    const b = (await addGym(deps(), director, { name: "New Gym", courts: ["Main", "Aux"] })) as { id: string };
    const court = async (gym: string) =>
      (await db.pool.query<{ id: string }>("select id::text from courts where gym_id = $1 limit 1", [gym])).rows[0].id;
    const t = await db.pool.query<{ id: string }>(
      "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Test', 'Girls', '{4}', 4, 'REC', 'x') returning id::text",
    );
    // Old Gym: one past booked practice and one upcoming open slot.
    await db.pool.query(
      `insert into slots (court_id, starts_at, team_id, created_by) values ($1, $2, $3, 'x'), ($1, $4, null, 'x')`,
      [await court(a.id), zonedTime(2026, 10, 1, 18), t.rows[0].id, zonedTime(2026, 11, 5, 18)],
    );
    // New Gym: an upcoming booked practice.
    await db.pool.query("insert into slots (court_id, starts_at, team_id, created_by) values ($1, $2, $3, 'x')", [
      await court(b.id),
      zonedTime(2026, 11, 5, 18),
      t.rows[0].id,
    ]);

    expect(await deleteGym(deps(), coach, a.id)).toMatchObject({ ok: false });
    expect(await deleteGym(deps(), { ...director, thunderAreas: ["teams"] }, a.id)).toMatchObject({ ok: false });
    expect(await deleteGym(deps(), director, b.id)).toEqual({
      ok: false,
      message: "New Gym has 1 upcoming booked practice. Release or move it first.",
    });
    expect(await deleteGym(deps(), director, a.id)).toEqual({ ok: true, kept: true });
    const old = await db.pool.query(
      "select g.active, (select count(*)::int from slots s join courts c on c.id = s.court_id where c.gym_id = g.id) as slots from gyms g where id = $1",
      [a.id],
    );
    expect(old.rows[0]).toEqual({ active: false, slots: 1 }); // the past practice stays

    await db.pool.query("delete from slots s using courts c where c.id = s.court_id and c.gym_id = $1", [b.id]);
    expect(await deleteGym(deps(), director, b.id)).toEqual({ ok: true, kept: false });
    expect((await db.pool.query("select count(*)::int n from gyms where id = $1", [b.id])).rows[0].n).toBe(0);

    expect(await addGym(deps(), director, { name: "old gym", courts: ["Main", "Side"] })).toEqual({ ok: true, id: a.id });
    const back = await db.pool.query("select name, active from courts where gym_id = $1 order by name", [a.id]);
    expect(back.rows).toEqual([
      { name: "Main", active: true },
      { name: "Side", active: true },
    ]);
  });
});
