import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { availableUses, facilitiesView, renameGym, setAvailability } from "./facilities";
import { createTestDb } from "./testing/db";

const director: SessionUser = {
  coachId: "9913694",
  firstName: "Earl",
  lastName: "Epps",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: true,
};
const teamsOnly: SessionUser = { ...director, thunderAreas: ["teams"] };

describe("Thunder Facilities: what each gym is for, by date", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-02T15:00:00Z") }); // Mon Nov 2
  let gym = "";
  const key = (d: string) => `${gym}:${d}`;

  beforeEach(async () => {
    await db.reset();
    const g = await db.pool.query<{ id: string }>("insert into gyms (name) values ('Action Church') returning id::text");
    gym = g.rows[0].id;
    await db.pool.query("insert into courts (gym_id, name) values ($1, 'Goal #1'), ($1, 'Goal #2')", [gym]);
  });

  it("choices follow Thunder's features: League Games only once a league approves", async () => {
    expect(await availableUses(db.pool)).toEqual({
      uses: ["practice"],
      partnerNote: "League game dates appear once a league approves Thunder as a hosting site.",
      leagues: "",
    });
    await db.pool.query(
      "insert into org_partnerships (host_org, for_org, status, requested_by) values ('thunder', 'scenic-city', 'approved', 'x')",
    );
    expect(await availableUses(db.pool)).toEqual({ uses: ["practice", "partner"], partnerNote: null, leagues: "Scenic City" });
    expect(
      await setAvailability(deps(), director, { gymId: gym, days: ["2026-11-07"], use: "in-house", defaults: true }),
    ).toEqual({ ok: false, message: "Thunder can't use In-House Games yet." });
  });

  it("a whole gym by date: default hours by weekday (Mon–Fri 6–9 PM, Sat–Sun 9 AM–9 PM), or set times; clearing removes them", async () => {
    expect(
      await setAvailability(deps(), director, {
        gymId: gym,
        days: ["2026-11-06", "2026-11-07"],
        use: "practice",
        defaults: true,
      }),
    ).toEqual({ ok: true, saved: 2, slotsAdded: 6 + 24, slotsRemoved: 0 }); // Fri 6, 7, 8 PM and Sat 9 AM–8 PM on both goals
    let v = (await facilitiesView(deps(), director))!;
    expect(v.gyms).toEqual([
      { id: gym, name: "Action Church", short: null, courts: ["Goal #1", "Goal #2"], address: null, lat: null, lng: null, placeId: null, pinLat: null, pinLng: null, pinAddress: null },
    ]);
    expect(v.days[key("2026-11-06")]).toEqual({ use: "practice", starts: "18:00", ends: "21:00", setBy: "Earl Epps" });
    expect(v.days[key("2026-11-07")]).toEqual({ use: "practice", starts: "09:00", ends: "21:00", setBy: "Earl Epps" });

    expect(
      await setAvailability(deps(), director, {
        gymId: gym,
        days: ["2026-11-07"],
        use: "practice",
        starts: "08:00",
        ends: "12:30",
      }),
    ).toMatchObject({ ok: true });
    expect(await setAvailability(deps(), director, { gymId: gym, days: ["2026-11-06"], use: null })).toEqual({
      ok: true,
      saved: 1,
      slotsAdded: 0,
      slotsRemoved: 6, // Friday's open practice slots go with it
    });
    v = (await facilitiesView(deps(), director))!;
    expect(v.days[key("2026-11-07")]).toMatchObject({ starts: "08:00", ends: "12:30" });
    expect(v.days[key("2026-11-06")]).toBeUndefined();
  });

  it("only Admins and Directors of Facilities; checks dates, times and the gym on the server", async () => {
    const ok = { gymId: gym, days: ["2026-11-07"], use: "practice", defaults: true };
    expect(await facilitiesView(deps(), teamsOnly)).toBeNull();
    expect(await setAvailability(deps(), teamsOnly, ok)).toMatchObject({ ok: false });
    expect(await setAvailability(deps(), director, { ...ok, days: ["2026-11-01"] })).toEqual({
      ok: false,
      message: "Past dates can't change.",
    });
    expect(await setAvailability(deps(), director, { ...ok, defaults: false, starts: "05:00", ends: "09:00" })).toMatchObject({
      ok: false,
    });
    expect(await setAvailability(deps(), director, { ...ok, defaults: false, starts: "19:00", ends: "18:00" })).toEqual({
      ok: false,
      message: "The end time must be after the start.",
    });
    expect(await setAvailability(deps(), director, { ...ok, defaults: false, starts: "18:15", ends: "20:00" })).toMatchObject({
      ok: false,
    });
    expect(await setAvailability(deps(), director, { ...ok, use: "party" })).toMatchObject({ ok: false });
    expect(await setAvailability(deps(), director, { ...ok, gymId: "999999" })).toEqual({
      ok: false,
      message: "That gym no longer exists.",
    });
    expect(await setAvailability(deps(), director, { ...ok, gymId: "" })).toEqual({ ok: false, message: "Pick a gym." });
  });

  it("Practice dates make 60-minute slots for each goal; other uses or clearing remove open ones; booked ones are kept", async () => {
    const slotTimes = async () =>
      (
        await db.pool.query<{ t: string }>(
          `select c.name || ' ' || to_char(s.starts_at at time zone 'America/New_York', 'MM-DD HH24:MI') || (case when s.team_id is null then '' else ' booked' end) as t
           from slots s join courts c on c.id = s.court_id order by s.starts_at, c.name`,
        )
      ).rows.map((r) => r.t);
    // Fri Nov 6, default 6–9 PM: 6, 7, 8 on both goals.
    expect(
      await setAvailability(deps(), director, { gymId: gym, days: ["2026-11-06"], use: "practice", defaults: true }),
    ).toEqual({ ok: true, saved: 1, slotsAdded: 6, slotsRemoved: 0 });
    expect(await slotTimes()).toEqual([
      "Goal #1 11-06 18:00",
      "Goal #2 11-06 18:00",
      "Goal #1 11-06 19:00",
      "Goal #2 11-06 19:00",
      "Goal #1 11-06 20:00",
      "Goal #2 11-06 20:00",
    ]);

    // Book 6 PM on Goal #1, then shorten to 6:30–8:30: only 6:30 and 7:30 fit, so the booked 6 PM would go → refused.
    const t = await db.pool.query<{ id: string }>(
      "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Test', 'Girls', '{4}', 4, 'REC', 'x') returning id::text",
    );
    await db.pool.query(
      `update slots set team_id = $1 where id = (select s.id from slots s join courts c on c.id = s.court_id
         where c.name = 'Goal #1' order by s.starts_at limit 1)`,
      [t.rows[0].id],
    );
    expect(
      await setAvailability(deps(), director, {
        gymId: gym,
        days: ["2026-11-06"],
        use: "practice",
        starts: "18:30",
        ends: "20:30",
      }),
    ).toEqual({ ok: false, message: "1 booked practice falls outside those hours. Release or move it first." });
    expect((await facilitiesView(deps(), director))!.days[key("2026-11-06")]).toMatchObject({ starts: "18:00", ends: "21:00" }); // unchanged

    // 6–8 PM keeps the booked 6 PM and drops the open 8 PM ones.
    expect(
      await setAvailability(deps(), director, {
        gymId: gym,
        days: ["2026-11-06"],
        use: "practice",
        starts: "18:00",
        ends: "20:00",
      }),
    ).toMatchObject({ ok: true, slotsAdded: 0, slotsRemoved: 2 });
    // Clearing the day: refused while the booked practice is there; once released, the open slots go.
    expect(await setAvailability(deps(), director, { gymId: gym, days: ["2026-11-06"], use: null })).toMatchObject({ ok: false });
    await db.pool.query("update slots set team_id = null");
    expect(await setAvailability(deps(), director, { gymId: gym, days: ["2026-11-06"], use: null })).toEqual({
      ok: true,
      saved: 1,
      slotsAdded: 0,
      slotsRemoved: 4,
    });
    expect(await slotTimes()).toEqual([]);
  });

  it("practice slots on blacked-out dates come in blocked", async () => {
    await db.pool.query(
      "insert into blackouts (day, gym_id, reason, created_by) values ('2026-11-26', null, 'Thanksgiving', 'x')",
    );
    await setAvailability(deps(), director, {
      gymId: gym,
      days: ["2026-11-26"],
      use: "practice",
      starts: "18:00",
      ends: "19:00",
    });
    const r = await db.pool.query("select blackout, note from slots order by court_id");
    expect(r.rows).toEqual([
      { blackout: true, note: "Thanksgiving" },
      { blackout: true, note: "Thanksgiving" },
    ]);
  });

  it("renames a gym (Facilities only; unique names; its slots and courts stay with it)", async () => {
    await db.pool.query("insert into gyms (name) values ('ERCC Main')");
    expect(await renameGym(deps(), teamsOnly, "thunder", gym, { name: "Action Church Gym" })).toMatchObject({ ok: false });
    expect(await renameGym(deps(), director, "thunder", gym, { name: "=HYPERLINK(1)" })).toMatchObject({ ok: false });
    expect(await renameGym(deps(), director, "thunder", gym, { name: "ercc main" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("already has that name"),
    });
    expect(await renameGym(deps(), director, "east-ridge", gym, { name: "Action Church Gym" })).toMatchObject({ ok: false }); // not theirs
    expect(await renameGym(deps(), director, "thunder", gym, { name: "  Action  Church Gym " })).toEqual({ ok: true, name: "Action Church Gym" });
    const row = await db.pool.query(
      "select g.name, g.short_name, count(c.id)::int as courts from gyms g join courts c on c.gym_id = g.id where g.id = $1 group by g.id",
      [gym],
    );
    expect(row.rows[0]).toEqual({ name: "Action Church Gym", short_name: null, courts: 2 });
    expect(await renameGym(deps(), director, "thunder", gym, { name: "Action Church Gym", short: "" })).toMatchObject({ ok: false }); // short given must be real
    expect(await renameGym(deps(), director, "thunder", gym, { name: "Action Church Gym", short: "ACG" })).toEqual({ ok: true, name: "Action Church Gym" });
    expect((await db.pool.query("select short_name from gyms where id = $1", [gym])).rows[0].short_name).toBe("ACG");
  });
});
