import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addLeaguePlayer, leagueRoster, mayManageLeagueTeam, removeLeaguePlayer, removeLeagueStaff, saveLeagueStaff } from "./league-roster";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false }) as SessionUser;
const dee = person("9913694", "Dee"); // Scenic City Director of Teams
const mo = person("5550101", "Mo"); // the team's Head Coach (a FastBreak team)
const sam = person("5550002", "Sam"); // nobody here

describe("a League team's roster and staff", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-23T15:00:00Z") });
  let team = "";
  let orgCopy = "";

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('9913694', 'Dee', 'X', '4239913694'), ('5550101', 'Mo', 'Gray', '4235550101'), ('5550002', 'Sam', 'X', '4235550002')`,
    );
    await grant(db.pool, "9913694 scenic-city Director");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'teams', 'test')");
    await db.pool.query(
      "insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, abbr) values ('FastBreak', 'Organization', false, true, true, 't', 'FB')",
    );
    team = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, coach_id, fastbreak_id, created_by, updated_by)
         select '5B Magic Gray', 'Boys', 5, 5, 'COMP', id, '5550101', 10, 't', 't' from partners where name = 'FastBreak' returning id::text`,
      )
    ).rows[0].id;
    // An organization's team's League copy: its roster is kept there, not here.
    await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('chatt', 'City of Chattanooga', 'Chatt', 'Organization') on conflict do nothing");
    const ot = (
      await db.pool.query<{ id: string }>(
        "insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('chatt', '5B Chatt Lee', 'Boys', 5, 5, 'COMP', 'x') returning id::text",
      )
    ).rows[0].id;
    orgCopy = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, org_team_id, created_by, updated_by)
         select '5B Chatt Lee', 'Boys', 5, 5, 'COMP', id, $1, 't', 't' from partners where name = 'FastBreak' returning id::text`,
        [ot],
      )
    ).rows[0].id;
  });

  it("its coach and the Directors of Teams add and remove players (by jersey number) and staff; nobody else", async () => {
    expect(await mayManageLeagueTeam(db.pool, mo, team)).toBe(true);
    expect(await mayManageLeagueTeam(db.pool, dee, team)).toBe(true);
    expect(await mayManageLeagueTeam(db.pool, sam, team)).toBe(false);
    expect(await mayManageLeagueTeam(db.pool, dee, orgCopy)).toBe(false); // kept on its organization's team page

    expect(await addLeaguePlayer(deps(), sam, team, { first: "Ava", last: "Lee" })).toMatchObject({ ok: false });
    expect(await addLeaguePlayer(deps(), mo, team, { first: "=cmd|x", last: "Lee" })).toMatchObject({ ok: false });
    expect(await addLeaguePlayer(deps(), mo, team, { first: "Ava", last: "Lee", birthdate: "2/30/2015" })).toMatchObject({ ok: false });
    expect(await addLeaguePlayer(deps(), mo, team, { first: "Ava", last: "Lee", grade: "5", jersey: "12", birthdate: "5/3/2015" })).toMatchObject({ ok: true });
    const ben = (await addLeaguePlayer(deps(), dee, team, { first: "Ben", last: "Cole", jersey: "3" })) as { id: string };
    await addLeaguePlayer(deps(), mo, team, { first: "Cal", last: "Day" });
    const roster = await leagueRoster(db.pool, team);
    expect(roster.map((p) => [p.first, p.jersey, p.birthdate, p.addedBy])).toEqual([
      ["Ben", "3", null, "Dee X"],
      ["Ava", "12", "2015-05-03", "Mo X"],
      ["Cal", null, null, "Mo X"],
    ]);
    expect(await removeLeaguePlayer(deps(), sam, ben.id)).toMatchObject({ ok: false });
    expect(await removeLeaguePlayer(deps(), mo, ben.id)).toEqual({ ok: true });
    expect((await leagueRoster(db.pool, team)).length).toBe(2);

    // Staff: one per role; adding again replaces; only its coach or a Director of Teams.
    expect(await saveLeagueStaff(deps(), sam, team, { role: "AsstCoach", first: "Al", last: "Ash", cell: "4235550303" })).toMatchObject({ ok: false });
    expect(await saveLeagueStaff(deps(), mo, team, { role: "Boss", first: "Al", last: "Ash", cell: "4235550303" })).toMatchObject({ ok: false });
    expect(await saveLeagueStaff(deps(), mo, team, { role: "AsstCoach", first: "Al", last: "Ash", cell: "423" })).toMatchObject({ ok: false });
    expect(await saveLeagueStaff(deps(), mo, team, { role: "AsstCoach", first: "Al", last: "Ash", cell: "(423) 555-0303" })).toEqual({ ok: true });
    expect(await saveLeagueStaff(deps(), mo, team, { role: "AsstCoach", first: "Bo", last: "Bell", cell: "4235550404", email: "bo@example.com" })).toEqual({ ok: true });
    const staff = await db.pool.query("select role, first_name, cell, email, added_by from scenic_team_staff where team_id = $1", [team]);
    expect(staff.rows).toEqual([{ role: "AsstCoach", first_name: "Bo", cell: "4235550404", email: "bo@example.com", added_by: "Mo X" }]);
    expect(await removeLeagueStaff(deps(), sam, team, "AsstCoach")).toMatchObject({ ok: false });
    expect(await removeLeagueStaff(deps(), dee, team, "AsstCoach")).toEqual({ ok: true });
    expect((await db.pool.query("select count(*)::int as n from scenic_team_staff")).rows[0].n).toBe(0);
  }, 120_000);
});
