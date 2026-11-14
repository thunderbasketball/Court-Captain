import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, grant } from "./testing/db";
import { answerGame, assignOfficial, myOfficiating, officialsBoard, officiatingSummary, removeOfficialFrom } from "./officiating-schedule";
import { addScrimmage, updateScrimmage, upcomingScrimmages } from "./scrimmages";

const ORG = "sc-officials";

describe("scheduling officials on games", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const now = new Date("2026-11-12T15:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const person = (coachId: string, extra: object = {}) =>
    ({ coachId, firstName: "P", lastName: coachId, isDirector: false, thunderAreas: [], ...extra }) as never;
  const director = person("5550001", { isDirector: true, thunderAreas: ["events"] });
  const otto = person("5550008"); // the group's Officials Assigner
  let program = "";
  let a = "";
  let g1 = ""; // 10 AM Nov 14, 90 minutes
  let g2 = ""; // 11 AM Nov 14 (overlaps g1)
  let g3 = ""; // 1 PM Nov 14

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(`delete from org_role_types where org = '${ORG}'; delete from organizations where slug = '${ORG}'`);
    await db.pool.query(`insert into organizations (slug, name, short_name, kind) values ('${ORG}', 'Scenic City Officials', 'SCO', 'Officials')`);
    await db.pool.query(`insert into org_role_types (org, role) select '${ORG}', r from unnest(array['Request', 'Coach', 'Director', 'Admin', 'Owner']) r`);
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Dee', 'Director', '4235550001'),
         ('5550008', 'Otto', 'X', '4235550008'), ('5550101', 'Rita', 'Ref', '4235550101'), ('5550102', 'Sam', 'Ump', '4235550102'),
         ('5550103', 'Rick', 'Rookie', '4235550103'), ('5550104', 'Nora', 'Nobody', '4235550104')`,
    );
    await grant(db.pool, `5550008 ${ORG} Director`);
    await db.pool.query(`insert into director_areas (coach_id, org, area, granted_by) values ('5550008', '${ORG}', 'officials', 't')`);
    await db.pool.query(
      `insert into org_features (org, feature, source, turned_on_by) values ('${ORG}', 'court-officials', 'setup', 't'), ('${ORG}', 'court-sync', 'setup', 't')`,
    );
    await db.pool.query(
      `insert into org_officials (org, coach_id, level, added_by) values ('${ORG}', '5550101', 'Certified', 'x'),
         ('${ORG}', '5550102', null, 'x'), ('${ORG}', '5550103', 'Recruit', 'x')`,
    );
    a = (
      await db.pool.query<{ id: string }>(
        "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    program = (
      await db.pool.query<{ id: string }>(
        "insert into player_programs (org, name, reg_opens, starts_on, ends_on, created_by) values ('thunder', 'Winter', '2026-10-01', '2026-11-01', '2027-02-28', 'x') returning id::text",
      )
    ).rows[0].id;
    const add = async (time: string, place: string) => {
      const r = await addScrimmage(deps(), director, "thunder", program, {
        home: a, away: "", awayName: "Signal 4G", date: "2026-11-14", time, minutes: 90, gymId: "", location: place, officials: ORG,
      });
      if (!r.ok) throw new Error(r.message);
      return r.id;
    };
    g1 = await add("10:00", "Signal Mountain MS");
    g2 = await add("11:00", "Red Bank MS");
    g3 = await add("13:00", "Signal Mountain MS");
  });

  it("the board: a card per day, a gym per place, 2 open spots a game; Recruits aren't offered; only the group's Assigners", async () => {
    expect(await officialsBoard(deps(), director, ORG)).toBeNull();
    const b = (await officialsBoard(deps(), otto, ORG))!;
    expect(b.officials.map((o) => o.last)).toEqual(["Ref", "Ump"]); // not Rick Rookie
    expect(b.days).toHaveLength(1);
    expect(b.days[0]).toMatchObject({ date: "2026-11-14", games: 3, open: 6 });
    expect(b.days[0].gyms.map((g) => [g.place, g.games.length])).toEqual([
      ["Signal Mountain MS", 2],
      ["Red Bank MS", 1],
    ]);
    expect(b.open).toBe(6);
  });

  it("assigns, moves and clears; never a Recruit, a stranger, one on two games at once, or after the start", async () => {
    const put = (gameId: string, position: number, officialId: string | null, from?: { gameId: string; position: number }) =>
      assignOfficial(deps(), otto, ORG, { gameId, position, officialId, from });
    expect(await assignOfficial(deps(), director, ORG, { gameId: g1, position: 1, officialId: "5550101" })).toMatchObject({ ok: false });
    expect(await put(g1, 1, "5550103")).toMatchObject({ ok: false, message: expect.stringContaining("Recruit") });
    expect(await put(g1, 1, "5550104")).toMatchObject({ ok: false }); // not one of the group's officials
    expect(await put(g1, 3, "5550101")).toMatchObject({ ok: false });
    expect(await put(g1, 1, "5550101")).toEqual({ ok: true });
    expect(await put(g1, 2, "5550101")).toMatchObject({ ok: false, message: expect.stringContaining("already on this game") });
    expect(await put(g2, 1, "5550101")).toMatchObject({ ok: false, message: expect.stringContaining("already on a game then") });
    expect(await put(g3, 1, "5550101")).toEqual({ ok: true }); // 1 PM: after the 10 AM game ends
    // Move Rita from game 1 spot 1 to its spot 2; then to game 2 (overlaps game 1, which she leaves).
    expect(await put(g1, 2, "5550101", { gameId: g1, position: 1 })).toEqual({ ok: true });
    expect(await put(g2, 2, "5550101", { gameId: g1, position: 2 })).toEqual({ ok: true });
    let b = (await officialsBoard(deps(), otto, ORG))!;
    const spots = (id: string) =>
      b.days[0].gyms.flatMap((g) => g.games).find((x) => x.id === id)!.spots.map((s) => s.official?.id ?? null);
    expect([spots(g1), spots(g2), spots(g3)]).toEqual([[null, null], [null, "5550101"], ["5550101", null]]);
    // A failed move leaves her where she was.
    expect(await put(g1, 1, "5550101", { gameId: g3, position: 1 })).toMatchObject({ ok: false }); // g1 overlaps g2
    b = (await officialsBoard(deps(), otto, ORG))!;
    expect(spots(g3)).toEqual(["5550101", null]);
    // Someone else in a taken spot takes their place; clearing a spot.
    expect(await put(g3, 1, "5550102")).toEqual({ ok: true });
    expect(await put(g2, 2, null)).toEqual({ ok: true });
    b = (await officialsBoard(deps(), otto, ORG))!;
    expect([spots(g2), spots(g3)]).toEqual([[null, null], ["5550102", null]]);
    expect(b.open).toBe(5);
    // After the start, it stays as it is.
    const later = { pool: db.pool, now: () => new Date("2026-11-14T18:05:00Z") };
    expect(await assignOfficial(later, otto, ORG, { gameId: g3, position: 2, officialId: "5550101" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("started"),
    });
  });

  it("takes one official off several games at once (a run in one gym); started games stay; only the group's Assigners", async () => {
    await assignOfficial(deps(), otto, ORG, { gameId: g1, position: 1, officialId: "5550101" });
    await assignOfficial(deps(), otto, ORG, { gameId: g3, position: 1, officialId: "5550101" });
    await assignOfficial(deps(), otto, ORG, { gameId: g3, position: 2, officialId: "5550102" });
    expect(await removeOfficialFrom(deps(), director, ORG, "5550101", [g1, g3])).toMatchObject({ ok: false });
    expect(await removeOfficialFrom(deps(), otto, ORG, "5550101", ["x"])).toMatchObject({ ok: false });
    const later = { pool: db.pool, now: () => new Date("2026-11-14T15:30:00Z") }; // game 1 has started
    expect(await removeOfficialFrom(later, otto, ORG, "5550101", [g1, g3])).toEqual({ ok: true, removed: 1 });
    const left = await db.pool.query("select scrimmage_id::text as g, coach_id from game_officials order by scrimmage_id, position");
    expect(left.rows).toEqual([
      { g: g1, coach_id: "5550101" },
      { g: g3, coach_id: "5550102" },
    ]);
  });

  it("an official's own games (their dashboard): soonest first, with their partner; gone once a game ends", async () => {
    await assignOfficial(deps(), otto, ORG, { gameId: g3, position: 1, officialId: "5550101" });
    await assignOfficial(deps(), otto, ORG, { gameId: g1, position: 2, officialId: "5550101" });
    await assignOfficial(deps(), otto, ORG, { gameId: g1, position: 1, officialId: "5550102" });
    const mine = await myOfficiating(deps(), "5550101");
    expect(mine.map((g) => [g.id, g.position, g.partner, g.group, g.away, g.place])).toEqual([
      [g1, 2, "Sam Ump", "SCO", "Signal 4G", "Signal Mountain MS"],
      [g3, 1, null, "SCO", "Signal 4G", "Signal Mountain MS"],
    ]);
    expect(mine[0].end.getTime() - mine[0].start.getTime()).toBe(90 * 60_000);
    const later = { pool: db.pool, now: () => new Date("2026-11-14T17:00:00Z") }; // the 10 AM game is over
    expect((await myOfficiating(later, "5550101")).map((g) => g.id)).toEqual([g3]);
    expect(await myOfficiating(deps(), "5550104")).toEqual([]);
  });

  it("a scrimmage changed to another group, or to a time that double-books, drops those officials", async () => {
    await assignOfficial(deps(), otto, ORG, { gameId: g1, position: 1, officialId: "5550101" });
    await assignOfficial(deps(), otto, ORG, { gameId: g3, position: 1, officialId: "5550101" });
    await assignOfficial(deps(), otto, ORG, { gameId: g3, position: 2, officialId: "5550102" });
    const form = (await upcomingScrimmages(deps(), "thunder", program)).find((s) => s.id === g3)!.form;
    // Game 3 moved to 10:30: Rita is on game 1 then, so she comes off it; Sam stays.
    expect(await updateScrimmage(deps(), director, "thunder", g3, { ...form, away: "", gymId: "", time: "10:30" })).toMatchObject({ ok: true });
    const spots = async (id: string) =>
      (await officialsBoard(deps(), otto, ORG))!.days[0].gyms.flatMap((g) => g.games).find((x) => x.id === id)!.spots.map((s) => s.official?.id ?? null);
    expect(await spots(g3)).toEqual([null, "5550102"]);
    expect(await spots(g1)).toEqual(["5550101", null]);
    // No officials: all of game 1's come off.
    const f1 = (await upcomingScrimmages(deps(), "thunder", program)).find((s) => s.id === g1)!.form;
    expect(await updateScrimmage(deps(), director, "thunder", g1, { ...f1, away: "", gymId: "", officials: "" })).toMatchObject({ ok: true });
    expect((await db.pool.query("select count(*)::int as n from game_officials where scrimmage_id = $1", [g1])).rows[0].n).toBe(0);
  });

  it("officials answer ✓ / ✗ on their own games before the start; the board shows it; a new time asks again", async () => {
    await assignOfficial(deps(), otto, ORG, { gameId: g1, position: 1, officialId: "5550101" });
    await assignOfficial(deps(), otto, ORG, { gameId: g3, position: 1, officialId: "5550101" });
    const rita = person("5550101");
    const sam = person("5550102");
    expect(await answerGame(deps(), sam, { gameId: g1, answer: "yes" })).toMatchObject({ ok: false }); // not on it
    expect(await answerGame(deps(), rita, { gameId: g1, answer: "maybe" })).toMatchObject({ ok: false });
    expect(await answerGame(deps(), rita, { gameId: g1, answer: "yes" })).toEqual({ ok: true });
    expect(await answerGame(deps(), rita, { gameId: g3, answer: "no" })).toEqual({ ok: true });
    expect((await myOfficiating(deps(), "5550101")).map((g) => g.answer)).toEqual(["yes", "no"]);
    const board = (await officialsBoard(deps(), otto, ORG))!;
    const spot = (id: string) => board.days[0].gyms.flatMap((g) => g.games).find((x) => x.id === id)!.spots[0];
    expect([spot(g1).answer, spot(g3).answer]).toEqual(["yes", "no"]);
    // Moved to the other spot of the same game: the answer stays. A different official in that spot: asks again.
    expect(await assignOfficial(deps(), otto, ORG, { gameId: g1, position: 2, officialId: "5550101", from: { gameId: g1, position: 1 } })).toEqual({ ok: true });
    expect((await myOfficiating(deps(), "5550101"))[0]).toMatchObject({ position: 2, answer: "yes" });
    // Game 1 moved half an hour: Rita answers again. Game 3 (not changed) keeps hers.
    const f1 = (await upcomingScrimmages(deps(), "thunder", program)).find((s) => s.id === g1)!.form;
    expect(await updateScrimmage(deps(), director, "thunder", g1, { ...f1, away: "", gymId: "", time: "09:30" })).toMatchObject({ ok: true });
    expect((await myOfficiating(deps(), "5550101")).map((g) => g.answer)).toEqual([null, "no"]);
    // Once a game has started, no more answers.
    const later = { pool: db.pool, now: () => new Date("2026-11-14T15:00:00Z") };
    expect(await answerGame(later, rita, { gameId: g1, answer: "yes" })).toMatchObject({ ok: false, message: expect.stringContaining("started") });
  });

  it("the card's title count (without building the board) matches the board: games and open spots; Assigners only", async () => {
    await assignOfficial(deps(), otto, ORG, { gameId: g1, position: 1, officialId: "5550101" });
    await assignOfficial(deps(), otto, ORG, { gameId: g3, position: 2, officialId: "5550102" });
    const board = (await officialsBoard(deps(), otto, ORG))!;
    expect(await officiatingSummary(deps(), otto, ORG)).toEqual({ games: board.days.reduce((n, d) => n + d.games, 0), open: board.open });
    expect(await officiatingSummary(deps(), otto, ORG)).toEqual({ games: 3, open: 4 });
    expect(await officiatingSummary(deps(), director, ORG)).toBeNull();
  });
});
