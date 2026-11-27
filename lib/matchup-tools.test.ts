import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { setDayPublished } from "./public-league";
import { scheduledGames } from "./scenic-games";
import { placeGame, unscheduleGym } from "./scenic-grid";
import { playIn, playInChoices } from "./league-team-change";
import { orgMetrics } from "./org-metrics";
import { correctGame, gamesToCorrect } from "./schedule-corrections";
import { addGame, clearMatchups, createDayMatchups, createMatchups, fillTbd, saveMatchups, switchHome } from "./scenic-matchups";
import { gameDaySchedule, poolFor, setDivisionGender } from "./scenic-programs";
import { updateScenicTeam, type TeamInput } from "./scenic-teams";
import { updateTeam } from "./teams";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false }) as SessionUser;
const dee = person("9913694", "Dee"); // Scenic City Admin
const bo = person("5550003", "Bo"); // a Director of nothing

describe("Scheduler: unschedule a gym, clear a division, fill in a TBD", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const now = new Date("2026-11-24T15:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const D1 = "2026-12-05";
  let prog = "";
  let div = "";
  let court = "";
  let gymKey = "";
  const t: Record<string, string> = {};
  const q = async <T extends object = { id: string }>(sql: string, p: unknown[] = []) => (await db.pool.query<T>(sql, p)).rows;
  type G = { id: string; a: string; b: string | null; fill: string | null; home: string; court: string | null; starts: string | null };
  const games = () =>
    q<G>(
      `select id::text, team_a::text as a, team_b::text as b, fill_team::text as fill, home_side as home, court_key as court, to_char(starts, 'HH24:MI') as starts
         from scenic_matchups where day = $1 order by id`,
      [D1],
    );
  const name = (id: string | null) => Object.keys(t).find((k) => t[k] === id) ?? "TBD";
  const tbd = async () => (await games()).find((g) => g.b === null)!;

  // REC: Host1, Host2 (Host has a gym), Solo (no gym); COMP: CompA, CompB.
  beforeEach(async () => {
    await db.reset();
    await q("delete from organizations where slug = 'club'");
    await q("insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Dee', 'X', '4239913694'), ('5550003', 'Bo', 'X', '4235550003')");
    await grant(db.pool, "9913694 scenic-city Director", "9913694 scenic-city Admin", "5550003 scenic-city Director");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'scheduling', 't')"); // a Director of Scheduling: only they change the schedule
    prog = (
      await q(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    )[0].id;
    await q("insert into scenic_program_options (program_id, kind, fee_cents) values ($1, 'all_season', 0)", [prog]);
    await q("insert into game_days (day, created_by) values ($1, 't')", [D1]);
    await q("insert into program_game_days (program_id, game_day_id, kind, added_by) select $1, id, 'game', 't' from game_days", [prog]);
    div = (await q("insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Boys', 5, 5) returning id::text", [prog]))[0].id;
    const partner = async (n: string, hosts: boolean) => (await q("insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values ($1, 'School', $2, true, true, 't') returning id::text", [n, hosts]))[0].id;
    const [host, away] = [await partner("Host", true), await partner("Away", false)];
    const pools: Record<string, string> = {};
    for (const level of ["REC", "COMP"]) {
      const g = (await q("insert into scenic_grade_groups (division_id, grade, level) values ($1, 5, $2) returning id::text", [div, level]))[0].id;
      pools[level] = (await q("insert into scenic_pools (group_id, name) values ($1, 'A') returning id::text", [g]))[0].id;
    }
    for (const [n, level, p] of [["CompA", "COMP", host], ["Host1", "REC", host], ["Host2", "REC", host], ["Solo", "REC", away], ["CompB", "COMP", away]] as const) {
      t[n] = (await q("insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, created_by, updated_by) values ($1, 'Boys', 5, 5, $2, $3, 't', 't') returning id::text", [n, level, p]))[0].id;
      await q("insert into scenic_registrations (program_id, team_id, pool_id, registered_by, all_season) values ($1, $2, $3, 't', true)", [prog, t[n], pools[level]]);
    }
    const gym = (await q("insert into partner_gyms (partner_id, name, created_by) values ($1, 'Gym', 't') returning id::text", [host]))[0].id;
    gymKey = `p${gym}`;
    court = (await q("insert into partner_courts (gym_id, name, created_by) values ($1, 'Court 1', 't') returning id::text", [gym]))[0].id;
    await q("insert into court_hours (court_id, game_day_id, starts, ends, set_by) select $1, id, '09:00', '17:00', 't' from game_days", [court]);
    expect(await createDayMatchups(deps(), dee, D1, prog)).toMatchObject({ ok: true, created: 3 });
  });
  const place = (id: string, starts: string) => placeGame(deps(), dee, id, { court, starts });

  it("who hosts is home: the team with no gym visits", async () => {
    const list = (await games()).filter((g) => g.b);
    for (const g of list) expect(name(g.home === "a" ? g.a : g.b)).toMatch(/^Host|^CompA/);
    expect(list.some((g) => [g.a, g.b].includes(t.Solo))).toBe(true); // not two Host teams against each other, with Solo left out
  });

  it("Admins and Owners see the schedule, view only; only a Director of Scheduling changes it", async () => {
    await q("insert into users (coach_id, first_name, last_name, cell) values ('5550007', 'Ann', 'Admin', '4235550007')");
    await grant(db.pool, "5550007 scenic-city Admin", "5550007 scenic-city Owner");
    const ann = person("5550007", "Ann");
    expect(await gameDaySchedule(deps(), ann)).not.toBeNull(); // sees it
    const g = (await games()).find((x) => x.b)!;
    expect(await placeGame(deps(), ann, g.id, { court, starts: "09:00" })).toMatchObject({ ok: false, message: expect.stringContaining("Director of Scheduling") });
    expect(await switchHome(deps(), ann, g.id)).toMatchObject({ ok: false });
    expect(await setDayPublished(deps(), ann, prog, D1, "REC", true)).toMatchObject({ ok: false });
    expect(await place(g.id, "09:00")).toEqual({ ok: true }); // Dee: a Director of Scheduling
  }, 60_000);

  it("home and away switched by hand (against TBD too): kept with who did it; never a published or scored game", async () => {
    const list = await games();
    const g = list.find((x) => x.b && ![x.a, x.b].includes(t.CompA))!;
    expect(await switchHome(deps(), bo, g.id)).toMatchObject({ ok: false }); // not a Director of Scheduling
    expect(await switchHome(deps(), dee, "x")).toMatchObject({ ok: false });
    expect(await switchHome(deps(), dee, g.id)).toEqual({ ok: true, placed: false });
    const [after] = await q<{ home: string; by: string }>("select home_side as home, home_set_by as by from scenic_matchups where id = $1", [g.id]);
    expect(after).toEqual({ home: g.home === "a" ? "b" : "a", by: "Dee X" });
    expect(await place(g.id, "09:00")).toEqual({ ok: true });
    expect(await switchHome(deps(), dee, g.id)).toEqual({ ok: true, placed: true }); // back again; stays on the grid
    expect((await games()).find((x) => x.id === g.id)).toMatchObject({ home: g.home, court });
    const open = list.find((x) => x.b === null);
    expect(open).toBeTruthy();
    expect(await switchHome(deps(), dee, open!.id)).toMatchObject({ ok: true });
    expect((await games()).find((x) => x.id === open!.id)!.home).toBe(open!.home === "b" ? "a" : "b"); // TBD home, or back
    await setDayPublished(deps(), dee, prog, D1, "REC", true);
    expect(await switchHome(deps(), dee, g.id)).toMatchObject({ ok: false, message: expect.stringContaining("published") });
  }, 60_000);

  it("a coach's games at different gyms are never back to back; at one gym that's fine", async () => {
    await q("update scenic_teams set coach_id = '5550003' where id in ($1, $2)", [t.Host1, t.CompA]);
    const host = (await q("select partner_id::text as id from scenic_teams where id = $1", [t.Host1]))[0].id;
    const gym2 = (await q("insert into partner_gyms (partner_id, name, created_by) values ($1, 'Gym 2', 't') returning id::text", [host]))[0].id;
    const court2 = (await q("insert into partner_courts (gym_id, name, created_by) values ($1, 'Court A', 't') returning id::text", [gym2]))[0].id;
    await q("insert into court_hours (court_id, game_day_id, starts, ends, set_by) select $1, id, '09:00', '17:00', 't' from game_days", [court2]);
    const list = await games();
    const g1 = list.find((x) => [x.a, x.b].includes(t.Host1))!;
    const g2 = list.find((x) => [x.a, x.b].includes(t.CompA))!;
    expect(await place(g1.id, "09:00")).toEqual({ ok: true });
    const at2 = (starts: string) => placeGame(deps(), dee, g2.id, { court: court2, starts });
    expect(await at2("09:55")).toMatchObject({ ok: false, message: expect.stringContaining("back to back at different gyms") }); // right after, across town
    expect(await place(g2.id, "09:55")).toEqual({ ok: true }); // the same gym, back to back
    expect(await at2("10:50")).toEqual({ ok: true }); // a game's break (the Grid shows it yellow)
  }, 60_000);

  it("unschedules every game at a gym, leaving the matchups; published and scored ones stay", async () => {
    const [g1, g2, g3] = await games();
    for (const [g, s] of [[g1, "09:00"], [g2, "09:55"], [g3, "10:50"]] as const) expect(await place(g.id, s)).toEqual({ ok: true });
    expect(await unscheduleGym(deps(), bo, D1, gymKey, prog)).toMatchObject({ ok: false });
    expect(await unscheduleGym(deps(), dee, D1, "p999", prog)).toMatchObject({ ok: false });
    expect(await unscheduleGym(deps(), dee, "x", gymKey, prog)).toMatchObject({ ok: false });
    await setDayPublished(deps(), dee, prog, D1, "COMP", true);
    expect(await unscheduleGym(deps(), dee, D1, gymKey, prog)).toEqual({ ok: true, off: 2, kept: 1 });
    expect((await games()).map((g) => !!g.court && [g.a, g.b].includes(t.CompA))).toEqual(expect.arrayContaining([true]));
    expect((await games()).filter((g) => g.court)).toHaveLength(1);
    await setDayPublished(deps(), dee, prog, D1, "COMP", false);
    expect(await unscheduleGym(deps(), dee, D1, gymKey, prog)).toEqual({ ok: true, off: 1, kept: 0 });
    expect(await games()).toHaveLength(3);
  }, 60_000);

  it("clears a division's matchups for the day, but not those on the grid or published", async () => {
    const list = await games();
    const rec = list.find((g) => g.b && [g.a, g.b].includes(t.Solo))!;
    await place(rec.id, "09:00");
    await setDayPublished(deps(), dee, prog, D1, "COMP", true);
    expect(await clearMatchups(deps(), bo, prog, D1, div)).toMatchObject({ ok: false });
    expect(await clearMatchups(deps(), dee, prog, D1, div, "ALL")).toMatchObject({ ok: false });
    expect(await clearMatchups(deps(), dee, prog, D1, div, "COMP")).toEqual({ ok: true, cleared: 0, kept: 1 }); // published
    expect(await clearMatchups(deps(), dee, prog, D1, div, "REC")).toEqual({ ok: true, cleared: 1, kept: 1 }); // the TBD one; not COMP's
    expect((await games()).map((g) => g.id)).toContain(rec.id);
    await setDayPublished(deps(), dee, prog, D1, "COMP", false);
    expect(await clearMatchups(deps(), dee, prog, D1, div)).toEqual({ ok: true, cleared: 1, kept: 1 });
    expect(await clearMatchups(deps(), dee, prog, D1, div)).toEqual({ ok: true, cleared: 0, kept: 1 });
  }, 60_000);

  it("a TBD is filled in with any team of the division, REC or COMP: an extra game, kept through saves, taken back", async () => {
    const g = await tbd();
    const owner = g.a;
    expect(await fillTbd(deps(), bo, g.id, t.CompB)).toMatchObject({ ok: false });
    expect(await fillTbd(deps(), dee, g.id, owner)).toMatchObject({ ok: false });
    expect(await fillTbd(deps(), dee, g.id, "999")).toMatchObject({ ok: false });
    expect(await fillTbd(deps(), dee, g.id, "x")).toMatchObject({ ok: false });
    // Only the same gender, a grade above or below at most, and never a team it already plays this season.
    const reg = async (name: string, gender: string, grade: number) => {
      const d = (await q("insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, $2, $3, $3) returning id::text", [prog, gender, grade]))[0].id;
      const gg = (await q("insert into scenic_grade_groups (division_id, grade, level) values ($1, $2, 'REC') returning id::text", [d, grade]))[0].id;
      const pl = (await q("insert into scenic_pools (group_id, name) values ($1, 'A') returning id::text", [gg]))[0].id;
      const id = (await q("insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, created_by, updated_by) select $1, $2, $3, $3, 'REC', id, 't', 't' from partners where name = 'Away' returning id::text", [name, gender, grade]))[0].id;
      await q("insert into scenic_registrations (program_id, team_id, pool_id, registered_by, all_season) values ($1, $2, $3, 't', true)", [prog, id, pl]);
      return id;
    };
    expect(await fillTbd(deps(), dee, g.id, await reg("Seven", "Boys", 7))).toMatchObject({ ok: false, message: expect.stringContaining("a grade above or below") });
    expect(await fillTbd(deps(), dee, g.id, await reg("G5", "Girls", 5))).toMatchObject({ ok: false, message: expect.stringContaining("is Girls") });
    const another = (await games()).find((x) => x.b && x.id !== g.id)!;
    await q("insert into game_days (day, created_by) values ('2026-12-12', 't')");
    await q("insert into program_game_days (program_id, game_day_id, kind, added_by) select $1, id, 'game', 't' from game_days where day = '2026-12-12'", [prog]);
    const met = another.a === owner || another.b === owner ? null : another.a;
    if (met) {
      await q("insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by) values ($1, $2, '2026-12-12', least($3::bigint, $4::bigint), greatest($3::bigint, $4::bigint), 't')", [prog, div, owner, met]);
      expect(await fillTbd(deps(), dee, g.id, met)).toMatchObject({ ok: false, message: expect.stringContaining("this season") });
      await q("delete from scenic_matchups where day = '2026-12-12'");
    }
    expect(await fillTbd(deps(), dee, g.id, null)).toMatchObject({ ok: false });
    expect(await place(g.id, "09:00")).toEqual({ ok: true });
    // A COMP team with its own game then: refused; free: the game keeps its place.
    const comp = (await games()).find((x) => [x.a, x.b].includes(t.CompA))!;
    expect(await place(comp.id, "09:55")).toEqual({ ok: true });
    await q("update scenic_matchups set starts = '09:00', court_key = '999' where id = $1", [comp.id]);
    expect(await fillTbd(deps(), dee, g.id, t.CompA)).toMatchObject({ ok: false, message: expect.stringContaining("already playing then") });
    await q("update scenic_matchups set starts = '09:55', court_key = $2 where id = $1", [comp.id, court]);
    expect(await fillTbd(deps(), dee, g.id, t.CompA)).toEqual({ ok: true });
    const after = (await games()).find((x) => x.id === g.id)!;
    expect(after).toMatchObject({ a: owner, b: t.CompA, fill: t.CompA, court, starts: "09:00" }); // even with the lower id: the owner is first
    expect(await fillTbd(deps(), dee, g.id, t.CompB)).toMatchObject({ ok: false }); // has an opponent now
    const day = async () => (await gameDaySchedule(deps(), dee))!.days[0].programs[0];
    expect((await day()).fills).toEqual({ [t.CompA]: [D1] });
    expect((await scheduledGames(db.pool, [t.CompA]))[t.CompA].map((x) => !!x.extra).sort()).toEqual([false, true]);

    // Saved from the board (home first): still there, its slot too; without the fill, REC vs COMP and extra games are refused.
    const list = (await games()).map((x) => (x.home === "b" && x.b ? [x.b, x.a] : [x.a, x.b]));
    expect(await saveMatchups(deps(), dee, prog, D1, div, list)).toEqual({ ok: true, saved: 3 });
    expect((await games()).find((x) => x.fill)).toMatchObject({ a: owner, b: t.CompA, court, starts: "09:00" });
    expect((await q("select filled_by as id from scenic_matchups where fill_team is not null"))[0].id).toBe("Dee X");
    expect(await saveMatchups(deps(), dee, prog, D1, div, [[t.Solo, t.CompB]])).toMatchObject({ ok: false });

    // The game's level is the team it was made for: publishing COMP leaves it, publishing REC locks it.
    const f = (await games()).find((x) => x.fill)!;
    await setDayPublished(deps(), dee, prog, D1, "REC", true);
    expect(await fillTbd(deps(), dee, f.id, null)).toMatchObject({ ok: false, message: expect.stringContaining("REC schedule is published") });
    await setDayPublished(deps(), dee, prog, D1, "REC", false);
    // Creating COMP again leaves it alone.
    expect(await createMatchups(deps(), dee, prog, D1, div, [], "COMP")).toMatchObject({ ok: true, created: 1 });
    expect((await games()).filter((x) => x.fill)).toHaveLength(1);
    const f2 = (await games()).find((x) => x.fill)!;
    expect(await fillTbd(deps(), dee, f2.id, null)).toEqual({ ok: true });
    expect(await tbd()).toMatchObject({ a: owner, fill: null, court, starts: "09:00" });
    // A team it already plays that day can't be picked.
    const other = (await games()).find((x) => x.b && [x.a, x.b].includes(t.Solo))!;
    const opp = other.a === t.Solo ? other.b! : other.a;
    await q("update scenic_matchups set court_key = null, starts = null");
    if (owner !== t.Solo) expect(await fillTbd(deps(), dee, f2.id, t.Solo)).toEqual({ ok: true });
    expect([t.Host1, t.Host2, t.Solo]).toContain(opp);
  }, 90_000);

  // A second division: Boys 6th–7th COMP with one team.
  async function otherDivision() {
    const d2 = (await q("insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Boys', 6, 7) returning id::text", [prog]))[0].id;
    const g2 = (await q("insert into scenic_grade_groups (division_id, grade, level) values ($1, 6, 'COMP') returning id::text", [d2]))[0].id;
    const pool = (await q("insert into scenic_pools (group_id, name) values ($1, 'A') returning id::text", [g2]))[0].id;
    const six = (await q("insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, created_by, updated_by) select 'Six', 'Boys', 6, 6, 'COMP', id, 't', 't' from partners where name = 'Away' returning id::text"))[0].id;
    await q("insert into scenic_registrations (program_id, team_id, pool_id, registered_by, all_season) values ($1, $2, $3, 't', true)", [prog, six, pool]);
    return { d2, pool, six };
  }

  it("the League places a team to play in another division (its own gender and grade stay); a division can be Coed", async () => {
    await q("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'teams', 't')");
    const { d2 } = await otherDivision();
    const six = (await q("insert into scenic_grade_groups (division_id, grade, level) values ($1, 6, 'REC') returning id::text", [d2]))[0].id;
    const sixRec = (await q("insert into scenic_pools (group_id, name) values ($1, 'A') returning id::text", [six]))[0].id;
    const gd = (await q("insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Girls', 5, 5) returning id::text", [prog]))[0].id;
    const gg = (await q("insert into scenic_grade_groups (division_id, grade, level) values ($1, 5, 'REC') returning id::text", [gd]))[0].id;
    const gPool = (await q("insert into scenic_pools (group_id, name) values ($1, 'A') returning id::text", [gg]))[0].id;
    const g5 = (await q("insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, created_by, updated_by) select 'G5', 'Girls', 5, 5, 'REC', id, 't', 't' from partners where name = 'Away' returning id::text"))[0].id;
    await q("insert into scenic_registrations (program_id, team_id, pool_id, registered_by, all_season) values ($1, $2, $3, 't', true)", [prog, g5, gPool]);
    const recPool = (await q("select pool_id::text as id from scenic_registrations where team_id = $1", [t.Host1]))[0].id; // Boys 5th REC
    const compPool = (await q("select pool_id::text as id from scenic_registrations where team_id = $1", [t.CompA]))[0].id;
    const where = async (id: string) => (await q<{ id: string; by: string | null; why: string | null }>("select pool_id::text as id, plays_in_by as by, plays_in_why as why from scenic_registrations where team_id = $1", [id]))[0];

    // Finley's case: a Girls team in the Boys division, with why.
    expect(await playIn(deps(), bo, g5, prog, recPool, "x", false)).toMatchObject({ ok: false });
    expect(await playIn(deps(), dee, g5, prog, recPool, " ", false)).toMatchObject({ ok: false, message: expect.stringContaining("Say why") });
    expect(await playIn(deps(), dee, g5, prog, recPool, "No Girls 5th REC", false)).toEqual({ ok: true });
    expect(await where(g5)).toEqual({ id: recPool, by: "Dee X", why: "No Girls 5th REC" });
    // REC to COMP (and back): the team stays REC; only where it plays changes.
    expect(await playIn(deps(), dee, g5, prog, compPool, "Plays COMP", true)).toEqual({ ok: true });
    expect(await where(g5)).toEqual({ id: compPool, by: "Dee X", why: "Plays COMP" });
    expect((await q("select level as id from scenic_teams where id = $1", [g5]))[0].id).toBe("REC");
    // The League's pages show it where it plays: COMP.
    expect((await gameDaySchedule(deps(), dee))!.days[0].programs[0].teams.find((x) => x.teamId === g5)?.level).toBe("COMP");
    expect(await playIn(deps(), dee, g5, prog, recPool, "No Girls 5th REC", true)).toEqual({ ok: true });
    const [choice] = await playInChoices(db.pool, g5, now);
    expect(choice.playsIn).toMatchObject({ label: expect.stringContaining("Boys 5th"), by: "Dee X", why: "No Girls 5th REC" });
    expect((await where(g5)).id).toBe(recPool);

    // Koch's case: up a grade. It has games that day: asked first, then they're to correct.
    const warned = await playIn(deps(), dee, t.Host1, prog, sixRec, "Plays up", false);
    expect(warned).toMatchObject({ ok: false, warn: [expect.stringContaining("Host1")] });
    expect(await playIn(deps(), dee, t.Host1, prog, sixRec, "Plays up", true)).toEqual({ ok: true });
    expect((await gamesToCorrect(db.pool, { org: "scenic-city" }, now)).some((g) => g.teams.includes(t.Host1))).toBe(true);
    // Back in its own: cleared.
    expect(await playIn(deps(), dee, t.Host1, prog, recPool, "", true)).toEqual({ ok: true });
    expect(await where(t.Host1)).toEqual({ id: recPool, by: null, why: null });

    // Boys 5th made Coed: it keeps its teams; then a Girls 5th COMP team registers into it.
    expect(await setDivisionGender(deps(), bo, div, "Coed")).toMatchObject({ ok: false });
    expect(await setDivisionGender(deps(), dee, div, "Girls")).toMatchObject({ ok: false, message: expect.stringContaining("aren't Girls") });
    expect(await setDivisionGender(deps(), dee, div, "Coed")).toEqual({ ok: true, label: "Coed 5th" });
    expect(await poolFor(db.pool as never, prog, { gender: "Girls", grade: 5, level: "COMP" })).toMatchObject({ gender: "Coed" });
    expect(await poolFor(db.pool as never, prog, { gender: "Girls", grade: 5, level: "REC" })).toMatchObject({ gender: "Girls" }); // its own first
    expect(await setDivisionGender(deps(), dee, div, "Boys")).toEqual({ ok: true, label: "Boys 5th" }); // G5 plays in (placed by the League)
  }, 120_000);

  it("a registered team's own changes never move it; the League moves it (Play in), its games warned of first, then to correct", async () => {
    await q("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'teams', 't')");
    const { pool } = await otherDivision();
    const solo = (await games()).find((g) => g.b && [g.a, g.b].includes(t.Solo))!;
    const edit = (grade: string, level: string) =>
      updateScenicTeam(deps(), dee, t.Solo, { name: "Solo", gender: "Boys", grade, level, coachFirst: "Bo", coachLast: "X", coachCell: "4235550003", for: "solo" } satisfies TeamInput);
    const where = async () => (await q<{ id: string; by: string | null }>("select pool_id::text as id, moved_by as by from scenic_registrations where team_id = $1", [t.Solo]))[0];
    const todo = () => gamesToCorrect(db.pool, { org: "scenic-city" }, now);
    const before = await where();
    expect(await edit("8", "COMP")).toMatchObject({ ok: true }); // the team may change; its division doesn't
    expect(await where()).toEqual(before);
    expect(await todo()).toEqual([]);
    expect(await edit("5-6", "COMP")).toMatchObject({ ok: true });
    await place(solo.id, "09:55");
    await setDayPublished(deps(), dee, prog, D1, "REC", true);
    const warned = await playIn(deps(), dee, t.Solo, prog, pool, "Plays up", false);
    expect(warned).toMatchObject({ ok: false, warn: [expect.stringMatching(/^Dec 5 9:55 AM at Gym: .*Solo.* · published$/)] });
    expect(await where()).toEqual(before); // nothing changed yet
    expect(await todo()).toEqual([]);
    expect(await playIn(deps(), dee, t.Solo, prog, pool, "Plays up", true)).toEqual({ ok: true });
    expect(await where()).toEqual({ id: pool, by: "Dee X" });
    // Left as it was, and to correct: on Home's To Do for the League's Admins.
    expect((await games()).find((g) => g.id === solo.id)).toMatchObject({ a: solo.a, b: solo.b, starts: "09:55" });
    const [c, ...rest] = await todo();
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ id: solo.id, division: "Boys 5th", gym: "Gym", published: true, why: ["Solo is now Boys 6th–7th COMP (changed by Dee X)"], teams: [t.Solo] });
    expect((await orgMetrics(deps(), dee, "scenic-city"))!.corrections).toHaveLength(1);
    expect(await gamesToCorrect(db.pool, { programId: prog }, new Date("2027-01-01"))).toEqual([]); // played
    expect(await correctGame(deps(), bo, solo.id, t.Solo)).toMatchObject({ ok: false });
    if (c.published) expect(await correctGame(deps(), dee, solo.id, t.Solo)).toMatchObject({ ok: false, message: expect.stringContaining("published") });
    await setDayPublished(deps(), dee, prog, D1, "REC", false);
    await setDayPublished(deps(), dee, prog, D1, "COMP", false);
    expect(await correctGame(deps(), dee, solo.id, solo.a === t.Solo ? solo.b : solo.a)).toMatchObject({ ok: false }); // not the one that changed
    expect(await correctGame(deps(), dee, solo.id, t.Solo)).toEqual({ ok: true });
    expect((await games()).find((g) => g.id === solo.id)).toMatchObject({ b: null, starts: "09:55" });
    expect(await todo()).toEqual([]);
    expect(await correctGame(deps(), dee, solo.id, null)).toMatchObject({ ok: false }); // nothing to correct
    // REC against COMP in one division (a level changed there): both are offered; the game can be removed.
    const comp = (await games()).find((g) => [g.a, g.b].includes(t.CompA))!;
    const g5 = (await q("select r.pool_id::text as id from scenic_registrations r where r.team_id = $1", [t.Host1]))[0].id;
    await q("update scenic_registrations set pool_id = $1 where team_id = $2", [g5, t.CompB]);
    expect((await todo())[0]).toMatchObject({ id: comp.id, teams: [t.CompA, t.CompB] });
    expect(await correctGame(deps(), dee, comp.id, null)).toEqual({ ok: true });
    expect(await todo()).toEqual([]);
  }, 90_000);

  it("games by hand across levels, grades and divisions: from a TBD, or a TBD in the New game box", async () => {
    const { d2, six } = await otherDivision();
    const g = await tbd();
    expect(await fillTbd(deps(), dee, g.id, six)).toEqual({ ok: true }); // another division
    expect((await games()).find((x) => x.id === g.id)).toMatchObject({ a: g.a, b: six, fill: six });
    expect(await gamesToCorrect(db.pool, { programId: prog }, now)).toEqual([]); // a fill-in isn't a mistake
    expect((await gameDaySchedule(deps(), dee))!.days[0].programs[0].fills).toEqual({ [six]: [D1] });
    // Kept through a save of the board, whichever side is first.
    const list = (await games()).map((x) => (x.home === "b" && x.b ? [x.b, x.a] : [x.a, x.b]));
    expect(await saveMatchups(deps(), dee, prog, D1, div, list)).toEqual({ ok: true, saved: 3 });
    expect((await games()).filter((x) => x.fill === six)).toHaveLength(1);
    expect(await fillTbd(deps(), dee, (await games()).find((x) => x.fill)!.id, null)).toEqual({ ok: true });

    const add = (a: unknown, b: unknown, d = div, who = dee) => addGame(deps(), who, prog, D1, d, a, b);
    expect(await add(t.CompA, six, div, bo)).toMatchObject({ ok: false });
    expect(await add(t.CompA, t.CompA)).toMatchObject({ ok: false });
    expect(await add(six, t.CompA)).toMatchObject({ ok: false }); // the first is this division's
    expect(await add(t.CompA, "999")).toMatchObject({ ok: false });
    expect(await add(t.CompA, t.CompB)).toMatchObject({ ok: false, message: expect.stringContaining("already play each other") });
    expect(await add(t.CompA, six)).toEqual({ ok: true }); // already has its game: an extra one
    expect((await games()).find((x) => x.fill === six)).toMatchObject({ a: t.CompA, b: six });
    expect(await add(t.Host1, t.CompB)).toEqual({ ok: true }); // REC against COMP
    expect(await add(six, null, d2)).toEqual({ ok: true }); // TBD for now
    expect(await add(six, null, d2)).toMatchObject({ ok: false, message: expect.stringContaining("already plays TBD") });
    await setDayPublished(deps(), dee, prog, D1, "COMP", true);
    expect(await add(t.CompB, six)).toMatchObject({ ok: false, message: expect.stringContaining("published") });
  }, 90_000);

  it("registered: its organization changes anything about the team; its division doesn't move", async () => {
    const earl = { ...person("9913694", "Earl"), isDirector: true, isAdmin: true, hasThunderRole: true } as SessionUser;
    // Thunder's: refused on its own page (even to the League's Admin there), unless nothing about it changes.
    const tt = (await q("insert into teams (name, gender, grades, grade_sort, level, created_by) values ('5B Lee', 'Boys', '{5}', 5, 'REC', 't') returning id::text"))[0].id;
    await q("update scenic_teams set thunder_team_id = $1 where id = $2", [tt, t.Solo]);
    const edit = (grades: string[], level: string) => updateTeam(deps() as never, earl, tt, { gender: "Boys", grades, level, practiceLocations: "Gym" });
    const poolOf = async () => (await q("select pool_id::text as id from scenic_registrations where team_id = $1", [t.Solo]))[0].id;
    const before = await poolOf();
    expect(await edit(["6"], "COMP")).toMatchObject({ ok: true });
    expect((await q("select grade || ' ' || level as id from scenic_teams where id = $1", [t.Solo]))[0].id).toBe("6 COMP"); // its copy follows
    expect(await poolOf()).toBe(before);
    // A Solo team's owner too.
    await q("update scenic_teams set partner_id = null, owner_coach_id = '5550003', coach_id = '5550003' where id = $1", [t.CompB]);
    await grant(db.pool, "5550003 scenic-city Solo");
    const own = (name: string, level: string) =>
      updateScenicTeam(deps(), bo, t.CompB, { name, gender: "Boys", grade: "5", level, coachFirst: "Bo", coachLast: "X", coachCell: "4235550003" } satisfies TeamInput);
    expect(await own("CompB", "REC")).toMatchObject({ ok: true });
    expect(await own("Renamed", "COMP")).toMatchObject({ ok: true });
  }, 90_000);
});
