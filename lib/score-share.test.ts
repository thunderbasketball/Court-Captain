import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { followedTeams, programSchedule, publicLeague } from "./public-league";
import { finalOf, scoreCard, shareText } from "./score-share";
import { gameCard, gameText } from "./game-share";
import { saveScore } from "./scores";
import { createTestDb, grant, testClock } from "./testing/db";

describe("a final, as the public pages show it", () => {
  const at = new Date("2026-12-05T17:00:00Z");
  const later = new Date("2026-12-05T17:10:00Z");
  const m = { id: "1", home_side: "b", score_a: 30, score_b: 28, forfeit: null, scored_at: at };
  it("home and away by the game's home side; its picture 10 minutes after the score; a forfeit has none", () => {
    expect(finalOf(m, later)).toEqual({ id: "1", home: 28, away: 30, forfeit: null, share: true });
    expect(finalOf({ ...m, home_side: null }, at)).toEqual({ id: "1", home: 30, away: 28, forfeit: null, share: false });
    expect(finalOf({ ...m, score_a: null, score_b: null, forfeit: "a" }, later)).toEqual({ id: "1", home: null, away: null, forfeit: "away", share: false });
    expect(finalOf({ ...m, score_a: null, score_b: null }, later)).toBeNull();
  });
});

describe("sharing a final (no login)", () => {
  const dee = { coachId: "9913694", firstName: "Dee", lastName: "X" } as SessionUser; // Scenic City Admin
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let clock = testClock();
  const deps = () => ({ pool: db.pool, now: clock.now });
  let prog = "";
  let game = "";
  let dev = "";
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  beforeEach(async () => {
    await db.reset();
    clock = testClock("2026-12-05T17:00:00Z");
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Dee', 'X', '4239913694'), ('5550002', 'Sam', 'Lee', '4235550002')",
    );
    await grant(db.pool, "9913694 scenic-city Admin");
    prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 5, 5);
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, created_by, updated_by) values
         ('Aces', 'Boys', 5, 5, 'COMP', '5550002', 't', 't'), ('Bolts', 'Boys', 5, 5, 'COMP', '5550002', 't', 't'), ('Sim 1 (DEV)', 'Boys', 5, 5, 'COMP', '5550002', 't', 't');
       insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select ${prog}, t.id, (select id from scenic_pools), 't' from scenic_teams t;
       insert into scenic_published_schedules (program_id, day, level, published_by, published_at) values (${prog}, '2026-12-05', 'COMP', 't', now());`,
    );
    const add = async (a: string, b: string) =>
      (
        await db.pool.query<{ id: string }>(
          `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by, home_side)
           select $1, (select id from scenic_divisions), '2026-12-05', a.id, b.id, 't', 'a' from scenic_teams a, scenic_teams b where a.name = $2 and b.name = $3 returning id::text`,
          [prog, a, b],
        )
      ).rows[0].id;
    game = await add("Aces", "Bolts");
    dev = await add("Aces", "Sim 1 (DEV)");
  });

  it("a game coming up: shared once it has a time and its day is published, until it's played; never a simulated team", async () => {
    expect(await gameCard(db.pool, game)).toBeNull(); // no time yet
    await db.pool.query("update scenic_matchups set court_key = id::text, starts = '09:00' where id in ($1, $2)", [game, dev]);
    const card = (await gameCard(db.pool, game))!;
    expect(card).toMatchObject({ id: game, org: "scenic-city", program: "Winter", group: "5th Boys COMP", day: "2026-12-05", starts: "09:00", home: { name: "Aces" }, away: { name: "Bolts" } });
    expect(gameText(card)).toBe("GAME DAY · 5th Boys COMP: Bolts at Aces");
    expect(JSON.stringify(card)).not.toMatch(/Sam|Lee|Dee|423/);
    expect(await gameCard(db.pool, dev)).toBeNull();
    for (const bad of ["", "x", "1; drop", "999999", null, 5]) expect(await gameCard(db.pool, bad)).toBeNull();
    await db.pool.query("delete from scenic_published_schedules");
    expect(await gameCard(db.pool, game)).toBeNull(); // not published
    await db.pool.query("insert into scenic_published_schedules (program_id, day, level, published_by, published_at) values ($1, '2026-12-05', 'COMP', 't', now())", [prog]);
    await saveScore(deps(), dee, game, { home: "20", away: "30" });
    expect(await gameCard(db.pool, game)).toBeNull(); // played
  });

  it("10 minutes after the score; a correction waits again; cleared, a forfeit, unpublished or a simulated team: never", async () => {
    expect(await scoreCard(db.pool, clock.now(), game)).toBeNull();
    await saveScore(deps(), dee, game, { home: "20", away: "30" });
    await saveScore(deps(), dee, dev, { home: "20", away: "30" });
    expect(await scoreCard(db.pool, clock.now(), game)).toBeNull();
    clock.advanceMinutes(10);
    const card = (await scoreCard(db.pool, clock.now(), game))!;
    expect(card).toEqual({ id: game, org: "scenic-city", program: "Winter", group: "5th Boys COMP", day: "2026-12-05", winner: { name: "Bolts", score: 30 }, loser: { name: "Aces", score: 20 } });
    expect(shareText(card)).toBe("FINAL · 5th Boys COMP: Bolts 30, Aces 20");
    expect(JSON.stringify(card)).not.toMatch(/Sam|Lee|Dee|423/);
    expect(await scoreCard(db.pool, clock.now(), dev)).toBeNull();
    for (const bad of ["", "x", "1; drop", "999999", null, 5]) expect(await scoreCard(db.pool, clock.now(), bad)).toBeNull();
    await saveScore(deps(), dee, game, { home: "20", away: "31" });
    expect(await scoreCard(db.pool, clock.now(), game)).toBeNull();
    clock.advanceMinutes(10);
    expect((await scoreCard(db.pool, clock.now(), game))?.winner.score).toBe(31);
    await db.pool.query("delete from scenic_published_schedules");
    expect(await scoreCard(db.pool, clock.now(), game)).toBeNull();
    await db.pool.query("insert into scenic_published_schedules (program_id, day, level, published_by, published_at) values ($1, '2026-12-05', 'COMP', 't', now())", [prog]);
    await saveScore(deps(), dee, game, { home: "", away: "" });
    clock.advanceMinutes(10);
    expect(await scoreCard(db.pool, clock.now(), game)).toBeNull();
    await saveScore(deps(), dee, game, { forfeit: "home" });
    clock.advanceMinutes(10);
    expect(await scoreCard(db.pool, clock.now(), game)).toBeNull();
  }, 60_000);

  it("the public schedule and a followed team show the final (once published), without who entered it", async () => {
    await saveScore(deps(), dee, game, { home: "20", away: "30" });
    clock.advanceMinutes(10);
    const want = { id: game, home: 20, away: 30, forfeit: null, share: true };
    const league = await publicLeague(db.pool, clock.now(), prog);
    expect(league?.schedule?.[0].games).toMatchObject([{ home: "Aces", away: "Bolts", final: want }]);
    const id = (await db.pool.query<{ id: string }>("select id::text from scenic_teams where name = 'Bolts'")).rows[0].id;
    expect((await followedTeams(db.pool, clock.now(), [id]))[0].programs[0].games).toMatchObject([{ opponent: "Aces", home: false, final: want }]);
    expect(JSON.stringify(league)).not.toMatch(/Dee/);
    await db.pool.query("delete from scenic_published_schedules");
    expect(await programSchedule(db.pool, prog, true, clock.now())).toEqual([]);
  }, 60_000);
});
