import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { setDayPublished } from "./public-league";
import { scheduledGames } from "./scenic-games";
import { placeGame, unscheduleGym } from "./scenic-grid";
import { leagueChangeTeam } from "./league-team-change";
import { orgMetrics } from "./org-metrics";
import { correctGame, gamesToCorrect } from "./schedule-corrections";
import { addGame, clearMatchups, createDayMatchups, createMatchups, fillTbd, saveMatchups } from "./scenic-matchups";
import { gameDaySchedule } from "./scenic-programs";
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

  it("a registered team whose grade or level changes moves; its games are warned of first, then shown until corrected", async () => {
    await q("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'teams', 't')");
    const { pool } = await otherDivision();
    const solo = (await games()).find((g) => g.b && [g.a, g.b].includes(t.Solo))!;
    const edit = (grade: string, level: string, anyway = false) =>
      updateScenicTeam(deps(), dee, t.Solo, { name: "Solo", gender: "Boys", grade, level, coachFirst: "Bo", coachLast: "X", coachCell: "4235550003", for: "solo" } satisfies TeamInput, anyway);
    const where = async () => (await q<{ id: string; by: string | null }>("select pool_id::text as id, moved_by as by from scenic_registrations where team_id = $1", [t.Solo]))[0];
    const todo = () => gamesToCorrect(db.pool, { org: "scenic-city" }, now);
    const before = await where();
    expect(await edit("8", "COMP", true)).toMatchObject({ ok: false, message: expect.stringContaining("has no Boys 8th COMP") });
    expect(await edit("5", "REC")).toMatchObject({ ok: true }); // the same: stays
    await place(solo.id, "09:55");
    await setDayPublished(deps(), dee, prog, D1, "REC", true);
    const warned = await edit("5-6", "COMP");
    expect(warned).toMatchObject({ ok: false, warn: [expect.stringMatching(/^Dec 5 9:55 AM at Gym: .*Solo.* · published$/)] });
    expect(await where()).toEqual(before); // nothing changed yet
    expect((await q("select level as id from scenic_teams where id = $1", [t.Solo]))[0].id).toBe("REC");
    expect(await todo()).toEqual([]);
    expect(await edit("5-6", "COMP", true)).toMatchObject({ ok: true });
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

  it("registered: only the League changes a team's gender, grade or level, an organization's and Thunder's too", async () => {
    const { pool, six } = await otherDivision();
    await q("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'teams', 't') on conflict do nothing");
    const earl = { ...person("9913694", "Earl"), isDirector: true, isAdmin: true, hasThunderRole: true } as SessionUser;
    const poolOf = async (id: string) => (await q("select pool_id::text as id from scenic_registrations where team_id = $1", [id]))[0].id;
    const change = (id: string, grade: string, level: string, anyway = false, who = dee) => leagueChangeTeam(deps(), who, id, { gender: "Boys", grade, level }, anyway);
    // Thunder's: refused on its own page (even to the League's Admin there), unless nothing about it changes.
    const tt = (await q("insert into teams (name, gender, grades, grade_sort, level, created_by) values ('5B Lee', 'Boys', '{5}', 5, 'REC', 't') returning id::text"))[0].id;
    await q("update scenic_teams set thunder_team_id = $1 where id = $2", [tt, t.Solo]);
    const edit = (grades: string[], level: string) => updateTeam(deps() as never, earl, tt, { gender: "Boys", grades, level, practiceLocations: "Gym" });
    expect(await edit(["6"], "COMP")).toMatchObject({ ok: false, message: expect.stringContaining("is registered in Winter: only the League can change") });
    expect(await edit(["5"], "REC")).toMatchObject({ ok: true });
    expect(await change(t.Solo, "6", "COMP", true, bo)).toMatchObject({ ok: false });
    expect(await change(t.Solo, "nope", "COMP", true)).toMatchObject({ ok: false });
    expect(await change(t.Solo, "6", "COMP")).toMatchObject({ ok: false, warn: [expect.stringContaining("not on the grid")] });
    expect((await q("select level as id from teams where id = $1", [tt]))[0].id).toBe("REC"); // nothing changed yet
    expect(await change(t.Solo, "6", "COMP", true)).toEqual({ ok: true });
    expect((await q("select name || ' ' || grades[1] || ' ' || level as id from teams where id = $1", [tt]))[0].id).toBe("6B Lee 6 COMP");
    expect((await q("select grade || ' ' || level as id from scenic_teams where id = $1", [t.Solo]))[0].id).toBe("6 COMP");
    expect(await poolOf(t.Solo)).toBe(pool);
    expect(await gamesToCorrect(db.pool, { programId: prog }, now)).toHaveLength(1);
    // An organization's: the same.
    await q("insert into organizations (slug, name, short_name, kind) values ('club', 'Club', 'Club', 'Organization') on conflict do nothing");
    const ot = (await q("insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('club', '6B Fox', 'Boys', 6, 6, 'COMP', 't') returning id::text"))[0].id;
    await q("update scenic_teams set org_team_id = $1 where id = $2", [ot, six]);
    expect(await change(six, "5", "REC", true)).toEqual({ ok: true });
    expect((await q("select grade || ' ' || level as id from org_teams where id = $1", [ot]))[0].id).toBe("5 REC");
    // Not registered now: its organization's again.
    await q("delete from scenic_registrations where team_id = $1", [six]);
    expect(await change(six, "6", "COMP", true)).toMatchObject({ ok: false, message: expect.stringContaining("its organization changes it") });
    // A Solo team's owner: everything else, not its grade or level.
    await q("update scenic_teams set partner_id = null, owner_coach_id = '5550003', coach_id = '5550003' where id = $1", [t.CompB]);
    await grant(db.pool, "5550003 scenic-city Solo");
    const own = (name: string, level: string) =>
      updateScenicTeam(deps(), bo, t.CompB, { name, gender: "Boys", grade: "5", level, coachFirst: "Bo", coachLast: "X", coachCell: "4235550003" } satisfies TeamInput, true);
    expect(await own("CompB", "REC")).toMatchObject({ ok: false, message: expect.stringContaining("only the League can change") });
    expect(await own("Renamed", "COMP")).toMatchObject({ ok: true });
  }, 90_000);
});
