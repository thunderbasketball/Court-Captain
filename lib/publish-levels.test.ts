import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { gamesOfTheWeek } from "./games-of-week";
import { orgMetrics } from "./org-metrics";
import { orgLeagues, orgPublicTeams, publicLeague, publishedLevels, setDayPublished, teamSoon } from "./public-league";
import { scheduledGames } from "./scenic-games";
import { dayGrid, placeGame, setGameLength, setProgramGameLength } from "./scenic-grid";
import { createDayMatchups, createMatchups, saveMatchups } from "./scenic-matchups";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false }) as SessionUser;
const dee = person("9913694", "Dee"); // Scenic City Admin
const bo = person("5550003", "Bo"); // a Director of nothing

describe("publishing REC and COMP separately", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const now = new Date("2026-11-24T15:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const D1 = "2026-12-05";
  const D2 = "2026-12-12";
  let prog = "";
  let div = "";
  let t: Record<string, string> = {};
  let court = "";
  const q = async <T extends object = { id: string }>(sql: string, p: unknown[] = []) => (await db.pool.query<T>(sql, p)).rows;
  const publish = (level: string, on = true, day = D1, who = dee) => setDayPublished(deps(), who, prog, day, level, on);
  const games = (day = D1) =>
    q<{ id: string; a: string; b: string; court: string | null; starts: string | null; level: string }>(
      `select m.id::text, m.team_a::text as a, m.team_b::text as b, m.court_key as court, to_char(m.starts, 'HH24:MI') as starts, t.level
         from scenic_matchups m join scenic_teams t on t.id = m.team_a where m.day = $1 order by t.level desc`,
      [day],
    );

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await q("insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Dee', 'X', '4239913694'), ('5550003', 'Bo', 'X', '4235550003')");
    await grant(db.pool, "9913694 scenic-city Director", "9913694 scenic-city Admin", "5550003 scenic-city Director");
    prog = (
      await q(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    )[0].id;
    await q("insert into scenic_program_options (program_id, kind, fee_cents) values ($1, 'all_season', 0)", [prog]);
    await q("insert into game_days (day, created_by) values ($1, 't'), ($2, 't')", [D1, D2]);
    await q("insert into program_game_days (program_id, game_day_id, kind, added_by) select $1, id, 'game', 't' from game_days", [prog]);
    // One division with REC and COMP, two teams each.
    div = (await q("insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Boys', 5, 5) returning id::text", [prog]))[0].id;
    t = {};
    const partner = (await q("insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values ('Hixson', 'School', true, true, true, 't') returning id::text"))[0].id;
    await q("insert into organizations (slug, name, short_name, kind) values ('chatt', 'Chatt', 'Chatt', 'Organization')");
    for (const level of ["REC", "COMP"]) {
      const g = (await q("insert into scenic_grade_groups (division_id, grade, level) values ($1, 5, $2) returning id::text", [div, level]))[0].id;
      const pool = (await q("insert into scenic_pools (group_id, name) values ($1, 'A') returning id::text", [g]))[0].id;
      for (const n of [1, 2]) {
        const key = `${level}${n}`;
        t[key] = (
          await q(
            `insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, created_by, updated_by) values ($1, 'Boys', 5, 5, $2, $3, 't', 't') returning id::text`,
            [key, level, partner],
          )
        )[0].id;
        await q("insert into scenic_registrations (program_id, team_id, pool_id, registered_by, all_season) values ($1, $2, $3, 't', true)", [prog, t[key], pool]);
      }
    }
    // REC1 is Chatt's.
    const ot = (await q("insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('chatt', 'REC1', 'Boys', 5, 5, 'REC', 't') returning id::text"))[0].id;
    await q("update scenic_teams set org_team_id = $1 where id = $2", [ot, t.REC1]);
    const gym = (await q("insert into partner_gyms (partner_id, name, created_by) values ($1, 'Gym', 't') returning id::text", [partner]))[0].id;
    court = (await q("insert into partner_courts (gym_id, name, created_by) values ($1, 'Court 1', 't') returning id::text", [gym]))[0].id;
    await q("insert into court_hours (court_id, game_day_id, starts, ends, set_by) select $1, id, '09:00', '13:00', 't' from game_days", [court]);
    expect(await createDayMatchups(deps(), dee, D1, prog)).toMatchObject({ ok: true, created: 2 });
  });

  it("each level on its own: only published games are public, the other says it will be published soon", async () => {
    const [rec, comp] = await games();
    expect([rec.level, comp.level]).toEqual(["REC", "COMP"]);
    const look = async () => (await publicLeague(db.pool, now, prog))!;
    expect(await look()).toMatchObject({ schedule: null, soon: ["REC", "COMP"] });
    expect((await scheduledGames(db.pool, [t.REC1]))[t.REC1][0].published).toBe(false);
    expect((await orgMetrics(deps(), dee, "scenic-city"))!.unpublished).toMatchObject([
      { day: D1, levels: ["REC", "COMP"] },
      { day: D2, levels: ["REC", "COMP"] },
    ]);

    // Who, what: Directors of Programs or Scheduling; a real level and Game Day.
    expect(await publish("COMP", true, D1, bo)).toMatchObject({ ok: false });
    for (const level of ["", "ALL", null, "rec"]) expect(await setDayPublished(deps(), dee, prog, D1, level, true)).toMatchObject({ ok: false });
    expect(await publish("COMP", true, "2026-12-06")).toMatchObject({ ok: false });

    expect(await publish("COMP")).toEqual({ ok: true });
    expect(await publish("COMP")).toEqual({ ok: true }); // again: the same
    let l = await look();
    expect(l.soon).toEqual(["REC"]);
    expect(l.schedule).toMatchObject([{ date: D1, soon: ["REC"], games: [{ group: "5th Boys COMP" }] }]);
    expect(l.schedule![0].games).toHaveLength(1);
    expect((await scheduledGames(db.pool, [t.REC1, t.COMP1]))[t.REC1][0].published).toBe(false);
    expect((await scheduledGames(db.pool, [t.COMP1]))[t.COMP1][0].published).toBe(true);
    expect(await teamSoon(db.pool, t.REC1, now)).toEqual(["REC"]);
    expect(await teamSoon(db.pool, t.COMP1, now)).toEqual([]);
    expect((await orgMetrics(deps(), dee, "scenic-city"))!.unpublished[0]).toMatchObject({ day: D1, levels: ["REC"] });
    expect((await gamesOfTheWeek(db.pool, now, "scenic-city"))!.day).toBe(D1);
    // An organization's own public page: its REC team waits; the League's public view is there.
    expect((await orgPublicTeams(db.pool, now, "chatt"))[0].programs[0]).toMatchObject({ level: "REC", games: null, soon: true });
    expect((await orgLeagues(db.pool, now, "chatt")).map((p) => [p.name, p.org])).toEqual([["Winter", "scenic-city"]]);
    expect(await orgLeagues(db.pool, now, "thunder")).toEqual([]); // no teams in it
    expect(await orgLeagues(db.pool, now, "scenic-city")).toEqual([]); // its own: already under Programs
    expect(await orgLeagues(db.pool, new Date("2027-03-05T15:00:00Z"), "chatt")).toEqual([]); // over

    expect(await publish("REC")).toEqual({ ok: true });
    l = await look();
    expect(l.soon).toEqual([]);
    expect(l.schedule).toMatchObject([{ date: D1, soon: [] }]);
    expect(l.schedule![0].games).toHaveLength(2);
    expect((await orgPublicTeams(db.pool, now, "chatt"))[0].programs[0]).toMatchObject({ games: [{ date: D1, opponent: "REC2" }], soon: false });
    expect([...(await publishedLevels(db.pool, prog))]).toEqual(expect.arrayContaining([[`${D1} REC`, "Dee X"], [`${D1} COMP`, "Dee X"]]));
    expect((await orgMetrics(deps(), dee, "scenic-city"))!.unpublished).toMatchObject([{ day: D2 }]);
    // After the last published day, the next ones are soon again.
    expect((await publicLeague(db.pool, new Date("2026-12-06T15:00:00Z"), prog))!.soon).toEqual(["REC", "COMP"]);
    // Taken back: only that level.
    expect(await publish("REC", false)).toEqual({ ok: true });
    expect((await look()).schedule![0].games.map((g) => g.group)).toEqual(["5th Boys COMP"]);
  });

  it("a published game can't be moved, taken off, re-paired or re-timed until it's unpublished; the other level can", async () => {
    const [rec, comp] = await games();
    const put = (id: string, starts: string | null) => placeGame(deps(), dee, id, starts ? { court, starts } : null);
    expect(await put(comp.id, "09:00")).toEqual({ ok: true });
    expect(await publish("COMP")).toEqual({ ok: true });
    const refused = { ok: false, message: "Dec 5's COMP schedule is published: its games can't be moved. Unpublish COMP for that day first." };
    expect(await put(comp.id, "09:55")).toEqual(refused);
    expect(await put(comp.id, null)).toEqual(refused);
    // REC isn't published: placed and moved freely.
    expect(await put(rec.id, "09:55")).toEqual({ ok: true });
    expect(await put(rec.id, "10:50")).toEqual({ ok: true });
    expect(await put(rec.id, null)).toEqual({ ok: true });
    // Published without a court and time yet: it can still get one, once.
    expect(await publish("REC")).toEqual({ ok: true });
    expect(await put(rec.id, "10:50")).toEqual({ ok: true });
    expect(await put(rec.id, "09:55")).toMatchObject({ ok: false });
    await publish("REC", false);

    // New times would move it: refused, nothing changed. The program's game length leaves that day as it is.
    expect(await setGameLength(deps(), dee, D1, 55)).toMatchObject({ ok: true }); // the same times
    await q("update game_days set minutes_override = null, override_by = null");
    await put(rec.id, null);
    await q("update scenic_matchups set starts = '09:55' where id = $1", [comp.id]); // the 2nd block: a longer game moves it
    expect(await setGameLength(deps(), dee, D1, 60)).toEqual(refused);
    expect((await dayGrid(deps(), dee, D1))!.minutes).toBe(55);
    expect(await setProgramGameLength(deps(), dee, prog, 60)).toMatchObject({ ok: true });
    expect((await dayGrid(deps(), dee, D1))!.minutes).toBe(55);
    expect((await dayGrid(deps(), dee, D2))!.minutes).toBe(60);
    expect((await games()).find((g) => g.id === comp.id)).toMatchObject({ court, starts: "09:55" });

    // REC and COMP created separately: the other level's games stay the very same, published or not.
    const both = await games();
    const ofLevel = (l: string, list = both) => list.filter((g) => g.level === l);
    expect(await createMatchups(deps(), dee, prog, D1, div, [], "REC")).toMatchObject({ ok: true, created: 1 });
    expect(ofLevel("COMP", await games())).toEqual(ofLevel("COMP"));
    await publish("COMP", false);
    expect(await createDayMatchups(deps(), dee, D1, prog, "REC")).toMatchObject({ ok: true, created: 1, divisions: 1 });
    expect(ofLevel("COMP", await games())).toEqual(ofLevel("COMP")); // not published, still left alone
    const recNow = ofLevel("REC", await games());
    expect(await createDayMatchups(deps(), dee, D1, prog, "COMP")).toMatchObject({ ok: true, created: 1 });
    expect(ofLevel("REC", await games())).toEqual(recNow);
    expect(ofLevel("COMP", await games())[0]).toMatchObject({ court, starts: "09:55" }); // the same pair keeps its slot
    expect(await createMatchups(deps(), dee, prog, D1, div, [], "ALL")).toMatchObject({ ok: false });
    expect(await createDayMatchups(deps(), dee, D1, prog, "x")).toMatchObject({ ok: false });
    await publish("COMP");
    expect(await createMatchups(deps(), dee, prog, D1, div, [], "COMP")).toMatchObject({ ok: false, message: expect.stringContaining("COMP schedule is published") });
    expect(await createDayMatchups(deps(), dee, D1, prog, "COMP")).toMatchObject({ ok: true, created: 0, notes: ["COMP: published, left as it is"] });

    // Matchups: COMP's stay the same game; REC's are made again.
    const before = (await games()).find((g) => g.level === "COMP")!;
    expect(await createMatchups(deps(), dee, prog, D1, div)).toMatchObject({ ok: true, created: 1 });
    expect((await games()).find((g) => g.level === "COMP")).toEqual(before);
    expect((await games()).find((g) => g.level === "REC")!.id).not.toBe(rec.id);
    const recPair = [t.REC1, t.REC2];
    const compPair = [t.COMP1, t.COMP2];
    const save = (list: unknown) => saveMatchups(deps(), dee, prog, D1, div, list);
    expect(await save([compPair])).toEqual({ ok: true, saved: 1 }); // REC's taken out, COMP's as it was
    expect((await games()).map((g) => g.id)).toEqual([before.id]);
    expect(await save([recPair])).toMatchObject({ ok: false, message: expect.stringContaining("COMP schedule is published") }); // COMP's left out
    expect(await save([recPair, [t.COMP1, null], [t.COMP2, null]])).toMatchObject({ ok: false });
    expect(await save([recPair, compPair])).toEqual({ ok: true, saved: 2 });
    expect((await games()).find((g) => g.level === "COMP")).toEqual(before);
    expect(await createDayMatchups(deps(), dee, D1, prog)).toMatchObject({ ok: true, created: 1, notes: ["COMP: published, left as it is"] });
    await publish("REC");
    expect(await createMatchups(deps(), dee, prog, D1, div)).toMatchObject({ ok: false, message: expect.stringContaining("REC and COMP") });
    expect(await createDayMatchups(deps(), dee, D1, prog)).toMatchObject({ ok: true, created: 0, divisions: 0 });

    // Unpublished: it moves.
    await publish("COMP", false);
    const compNow = (await games()).find((g) => g.level === "COMP")!; // created again above
    expect(await put(compNow.id, "09:00")).toEqual({ ok: true });
  });

  it("what the live site publishes the old way (a whole day) counts for both levels", async () => {
    await q("insert into scenic_published_days (program_id, day, published_by, published_at) values ($1, $2, 'Old', now())", [prog, D1]);
    expect([...(await publishedLevels(db.pool, prog)).keys()].sort()).toEqual([`${D1} COMP`, `${D1} REC`]);
    await q("delete from scenic_published_days");
    expect((await publishedLevels(db.pool, prog)).size).toBe(0);
  });
});
