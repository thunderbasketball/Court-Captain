import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pinFrom, readPin, setGymPin, setGymPlace, setSchedulerPin, suggestPlaces } from "./places";
import { PLACE_SQL } from "./scenic-games";
import { createTestDb } from "./testing/db";

const director = { coachId: "9913694", firstName: "Dee", lastName: "X", isDirector: true } as never; // every Thunder area
const coach = { coachId: "5550001", firstName: "Cal", lastName: "X", isDirector: false } as never;
const PLACE = "ChIJabcdefghij123";

// Google's answers, faked: a search and a place's details.
const fake = (async (url: string) => {
  if (String(url).endsWith(":autocomplete"))
    return new Response(
      JSON.stringify({
        suggestions: [
          { placePrediction: { placeId: PLACE, structuredFormat: { mainText: { text: "Action Church" }, secondaryText: { text: "Chattanooga, TN" } } } },
          { placePrediction: { placeId: "bad id!" } },
        ],
      }),
    );
  return new Response(
    JSON.stringify({ id: PLACE, displayName: { text: "Action Church" }, formattedAddress: "123 Main St, Chattanooga, TN 37404", location: { latitude: 35.03, longitude: -85.27 } }),
  );
}) as typeof fetch;

describe("gym locations", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-11T17:00:00Z"), fetch: fake });
  let gym = "";
  beforeEach(async () => {
    await db.reset();
    process.env.GOOGLE_PLACES_API_KEY = "test-key";
    gym = (await db.pool.query<{ id: string }>("insert into gyms (name) values ('Action Church') returning id::text")).rows[0].id;
  });
  afterEach(() => {
    delete process.env.GOOGLE_PLACES_API_KEY;
  });

  it("searches (3+ letters), keeping only good place ids", async () => {
    expect(await suggestPlaces("Ac", "session-1234", fake)).toEqual({ ok: true, hits: [] });
    expect(await suggestPlaces("Action", "session-1234", fake)).toEqual({
      ok: true,
      hits: [{ placeId: PLACE, name: "Action Church", address: "Chattanooga, TN" }],
    });
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(await suggestPlaces("Action", "session-1234", fake)).toMatchObject({ ok: false, message: expect.stringContaining("isn't set up") });
  });

  it("sets a gym's place from Google (never the browser's address), only for those who manage gyms; and clears it", async () => {
    expect(await setGymPlace(deps(), coach, "thunder", gym, PLACE)).toMatchObject({ ok: false });
    expect(await setGymPlace(deps(), director, "thunder", gym, "nope")).toMatchObject({ ok: false });
    expect(await setGymPlace(deps(), director, "thunder", gym, PLACE, "session-1234")).toEqual({
      ok: true,
      address: "123 Main St, Chattanooga, TN 37404",
    });
    const row = await db.pool.query("select address, lat, lng, place_id, place_set_by from gyms where id = $1", [gym]);
    expect(row.rows[0]).toEqual({ address: "123 Main St, Chattanooga, TN 37404", lat: 35.03, lng: -85.27, place_id: PLACE, place_set_by: "Dee X" });
    expect(await setGymPlace(deps(), director, "east-ridge", gym, PLACE)).toMatchObject({ ok: false }); // another organization's
    expect(await setGymPlace(deps(), director, "thunder", gym, null)).toEqual({ ok: true, address: null });
    expect((await db.pool.query("select address, place_id from gyms where id = $1", [gym])).rows[0]).toEqual({ address: null, place_id: null });
  });

  it("reads a pin copied from Google Maps: the numbers, a full link, or a short share link (Google's only)", async () => {
    expect(pinFrom("35.0312, -85.2701")).toEqual({ lat: 35.0312, lng: -85.2701 });
    expect(pinFrom("https://www.google.com/maps/place/Action+Church/@35.03,-85.28,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d35.0312!4d-85.2701")).toEqual({
      lat: 35.0312,
      lng: -85.2701,
    }); // the pin (!3d!4d), not where the map looked (@)
    expect(pinFrom("https://maps.google.com/?q=35.1,-85.2")).toEqual({ lat: 35.1, lng: -85.2 });
    expect(pinFrom("95.0, 10.0")).toBeNull(); // not on Earth
    expect(pinFrom("Action Church")).toBeNull();
    const hops: string[] = [];
    const short = (async (url: string) => {
      hops.push(String(url));
      return new Response(null, { status: 302, headers: { location: "https://www.google.com/maps/place/X/@35.2,-85.1,17z" } });
    }) as typeof fetch;
    expect(await readPin("https://maps.app.goo.gl/abc123", short)).toEqual({ lat: 35.2, lng: -85.1 });
    expect(await readPin("https://evil.example.com/maps?q=35.1,-85.2", short)).toEqual({ lat: 35.1, lng: -85.2 }); // numbers in the text are read, nothing opened
    expect(await readPin("https://evil.example.com/x", short)).toBeNull(); // other sites are never opened
    expect(hops).toEqual(["https://maps.app.goo.gl/abc123"]);
  });

  it("a hand-set pin is kept apart from the Google place (Directions go to the pin); and removed", async () => {
    expect(await setGymPlace(deps(), director, "thunder", gym, PLACE, "session-1234")).toMatchObject({ ok: true });
    expect(await setGymPin(deps(), coach, "thunder", gym, { pin: "35.0312, -85.2701", address: "123 Main St" })).toMatchObject({ ok: false });
    expect(await setGymPin(deps(), director, "thunder", gym, { pin: "here", address: "123 Main St" })).toMatchObject({ ok: false });
    expect(await setGymPin(deps(), director, "thunder", gym, { pin: "35.0312, -85.2701", address: "x" })).toMatchObject({ ok: false });
    expect(await setGymPin(deps(), director, "thunder", gym, { pin: "35.0399, -85.2799", address: " Back lot,  Main St " })).toEqual({
      ok: true,
      address: "Back lot, Main St",
    });
    const row = await db.pool.query("select address, lat, place_id, pin_lat, pin_lng, pin_address from gyms where id = $1", [gym]);
    expect(row.rows[0]).toEqual({
      address: "123 Main St, Chattanooga, TN 37404", // the Google address stays (it's the one shown)
      lat: 35.03,
      place_id: PLACE,
      pin_lat: 35.0399,
      pin_lng: -85.2799,
      pin_address: "Back lot, Main St",
    });
    expect(await setGymPin(deps(), director, "thunder", gym, null)).toEqual({ ok: true, address: null });
    expect((await db.pool.query("select pin_lat, address from gyms where id = $1", [gym])).rows[0]).toEqual({
      pin_lat: null,
      address: "123 Main St, Chattanooga, TN 37404",
    });
  });

  it("a Scheduler uses the host's location, or overrides its own schedules' Directions with its pin", async () => {
    const scenicDirector = { coachId: "5550009", firstName: "Sue", lastName: "S" } as never;
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550009', 'Sue', 'S', '4235550009')");
    await db.pool.query("select set_role('5550009', 'scenic-city', 'Admin', true, 'test')");
    await db.pool.query(
      "insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values ('Thunder', 'Organization', true, false, true, 'x', 'thunder')",
    );
    const program = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-27', '2026-10-01', '2026-11-20', 'x', 'x') returning id::text`,
      )
    ).rows[0].id;
    const where = async () =>
      (
        await db.pool.query(
          `select place.address, place.map_lat, place.map_lng, place.map_place from (values ($1::text, $2::bigint)) m (court_key, program_id) ${PLACE_SQL}`,
          [`o${gym}-gym`, program],
        )
      ).rows[0];
    // The host's Google place, then the host's pin.
    await setGymPlace(deps(), director, "thunder", gym, PLACE, "session-1234");
    expect(await where()).toEqual({ address: "123 Main St, Chattanooga, TN 37404", map_lat: 35.03, map_lng: -85.27, map_place: PLACE });
    await setGymPin(deps(), director, "thunder", gym, { pin: "35.0399, -85.2799", address: "Back lot" });
    expect(await where()).toMatchObject({ address: "123 Main St, Chattanooga, TN 37404", map_lat: 35.0399, map_place: null });
    // The Scheduler's own pin wins on its schedules; only its Facilities people set it.
    expect(await setSchedulerPin(deps(), director, "scenic-city", `o${gym}`, { pin: "35.05, -85.25", label: "Gym door" })).toMatchObject({ ok: false });
    expect(await setSchedulerPin(deps(), scenicDirector, "scenic-city", "o999999", { pin: "35.05, -85.25", label: "Gym door" })).toMatchObject({ ok: false });
    expect(await setSchedulerPin(deps(), scenicDirector, "scenic-city", `o${gym}`, { pin: "35.05, -85.25", label: "Gym door" })).toEqual({ ok: true, label: "Gym door" });
    expect(await where()).toMatchObject({ map_lat: 35.05, map_lng: -85.25, map_place: null });
    expect(await setSchedulerPin(deps(), scenicDirector, "scenic-city", `o${gym}`, null)).toEqual({ ok: true, label: null });
    expect(await where()).toMatchObject({ map_lat: 35.0399 });
  });
});
