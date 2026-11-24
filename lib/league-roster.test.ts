import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import {
  addLeaguePlayer,
  importLeagueRows,
  leagueRoster,
  mayManageLeagueTeam,
  previewLeagueImport,
  previewLeagueRows,
  removeLeaguePlayer,
  removeLeagueStaff,
  saveLeagueStaff,
  setLeagueBirthdate,
} from "./league-roster";
import { leagueStaff, leagueTeamPage, myLeagueTeams } from "./scenic-team-page";
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

  it("imports its roster like an organization's, birthdates can be fixed, and its Assistant Coach logs in and manages the team", async () => {
    const text = "Zoe Hart II     3/20/2017    4   24\nEli Park    9/1/2017   4   5\nAva Lee   1/1/2016   4   12";
    const layout = { columns: ["name", "birthdate", "grade", "jersey"], header: false };
    await addLeaguePlayer(deps(), mo, team, { first: "Ava", last: "Lee", jersey: "7" });
    expect(await previewLeagueImport(deps(), sam, team, text, layout)).toMatchObject({ ok: false });
    expect(await previewLeagueImport(deps(), dee, orgCopy, text, layout)).toMatchObject({ ok: false }); // kept on its organization's page
    const pre = await previewLeagueImport(deps(), mo, team, text, layout);
    if (!pre.ok) throw new Error(pre.message);
    expect(pre.rows.map((r) => [r.first, r.last, r.status])).toEqual([
      ["Zoe", "Hart II", "new"],
      ["Eli", "Park", "new"],
      ["Ava", "Lee", "exists"],
    ]);
    const bad = [{ ...pre.rows[0], grade: "" }];
    expect(await previewLeagueRows(deps(), mo, team, bad)).toMatchObject({ ok: true, rows: [{ status: "error" }] });
    expect(await importLeagueRows(deps(), sam, team, pre.rows)).toMatchObject({ ok: false });
    expect(await importLeagueRows(deps(), mo, team, [...pre.rows, { ...pre.rows[0], first: "Kit", jersey: "5" }, { ...pre.rows[0], first: "=x" }])).toMatchObject({
      ok: true,
      added: ["Zoe Hart II", "Eli Park"],
      skipped: ["Ava Lee: already on the team", "Kit Hart II: #5 is taken", expect.stringContaining("First and last name")],
    });
    const eli = (await leagueRoster(db.pool, team)).find((p) => p.first === "Eli")!;
    expect(await setLeagueBirthdate(deps(), sam, team, eli.id, "5/3/2016")).toMatchObject({ ok: false });
    expect(await setLeagueBirthdate(deps(), mo, team, eli.id, "nope")).toMatchObject({ ok: false });
    expect(await setLeagueBirthdate(deps(), mo, team, eli.id, "5/3/2016")).toEqual({ ok: true });
    expect((await leagueRoster(db.pool, team)).find((p) => p.first === "Eli")!.birthdate).toBe("2016-05-03");

    // The coach adds an Assistant Coach: a login with that cell, the Coach role, this team; a Manager is contact only.
    const coachRole = async (cell: string) =>
      (await db.pool.query("select 1 from org_roles r join users u on u.coach_id = r.coach_id where u.cell = $1 and r.org = 'scenic-city' and r.role = 'Coach'", [cell])).rowCount;
    expect(await saveLeagueStaff(deps(), mo, team, { role: "AsstCoach", first: "Al", last: "Ash", cell: "4235550303", email: "al@example.com" })).toEqual({ ok: true });
    expect(await saveLeagueStaff(deps(), mo, team, { role: "Manager", first: "Meg", last: "May", cell: "4235550505" })).toEqual({ ok: true });
    const al = person("5550303", "Al");
    expect(await coachRole("4235550303")).toBe(1);
    expect(await coachRole("4235550505")).toBe(0);
    expect(await mayManageLeagueTeam(db.pool, al, team)).toBe(true);
    expect((await myLeagueTeams(db.pool, "5550303")).map((t) => t.id)).toEqual([team]);
    expect(await leagueTeamPage(db.pool, al, team)).not.toBeNull();
    expect((await leagueStaff(db.pool, [team]))[team].map((m) => [m.role, m.first, m.coachId])).toEqual([
      ["HeadCoach", "Mo", "5550101"],
      ["AsstCoach", "Al", "5550303"],
      ["Manager", "Meg", null],
    ]);
    // An Assistant Coach changes the Manager and Team Parent, never the Assistant Coach.
    expect(await saveLeagueStaff(deps(), al, team, { role: "TeamParent", first: "Pat", last: "Poe", cell: "4235550606" })).toEqual({ ok: true });
    expect(await removeLeagueStaff(deps(), al, team, "TeamParent")).toEqual({ ok: true });
    expect(await saveLeagueStaff(deps(), al, team, { role: "AsstCoach", first: "Zed", last: "Zee", cell: "4235550707" })).toMatchObject({ ok: false });
    expect(await removeLeagueStaff(deps(), al, team, "AsstCoach")).toMatchObject({ ok: false });
    // Replaced: the new one's login; the first no longer coaches here. Removed: neither does the second.
    expect(await saveLeagueStaff(deps(), mo, team, { role: "AsstCoach", first: "Bo", last: "Bell", cell: "4235550404" })).toEqual({ ok: true });
    expect([await coachRole("4235550303"), await coachRole("4235550404")]).toEqual([0, 1]);
    expect(await mayManageLeagueTeam(db.pool, al, team)).toBe(false);
    expect(await removeLeagueStaff(deps(), mo, team, "AsstCoach")).toEqual({ ok: true });
    expect(await coachRole("4235550404")).toBe(0);
  }, 120_000);
});
