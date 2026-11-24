import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { leagueStaff, leagueTeamPage, myLeagueTeams } from "./scenic-team-page";
import { teamRequests } from "./schedule-requests";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false }) as SessionUser;
const dee = person("9913694", "Dee"); // Scenic City Director of Teams
const ethan = person("5550101", "Ethan"); // Solo owner and Head Coach
const sam = person("5550002", "Sam"); // nobody here

describe("a League team's page", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  let team = "";
  let prog = "";

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell, email) values
         ('9913694', 'Dee', 'X', '4239913694', null), ('5550101', 'Ethan', 'Robinson', '7065062534', 'e@example.com'),
         ('5550002', 'Sam', 'X', '4235550002', null)`,
    );
    await grant(db.pool, "9913694 scenic-city Director", "5550101 scenic-city Solo");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'teams', 'test')");
    prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2099-02-28', '2026-10-01', '2099-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 4, 5);
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;`,
    );
    team = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, alt_name, created_by, updated_by)
         values ('5B Jackets Robinson', 'Boys', 5, 5, 'COMP', '5550101', '5550101', 'Jackets', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into scenic_registrations (program_id, team_id, pool_id, registered_by, paid, all_season)
       select ${prog}, ${team}, id, 't', true, true from scenic_pools`,
    );
  });

  it("its coach and owner, and the League's Directors of Teams, see it; nobody else; a coach's Home is their team", async () => {
    expect(await leagueTeamPage(db.pool, sam, team)).toBeNull();
    expect(await leagueTeamPage(db.pool, ethan, "junk")).toBeNull();
    const mine = await leagueTeamPage(db.pool, ethan, team);
    expect(mine).toMatchObject({
      manage: false,
      team: { name: "5B Jackets Robinson", grades: "5th Grade", level: "COMP", from: "Solo · Ethan Robinson" },
      head: { coachId: "5550101", first: "Ethan", last: "Robinson" },
      programs: [{ name: "Winter", division: "Boys 4th–5th · 5th COMP", paid: true, out: false, entry: { allSeason: true, bracket: true } }],
    });
    expect(await leagueTeamPage(db.pool, dee, team)).toMatchObject({ manage: true });
    expect(await myLeagueTeams(db.pool, "5550101")).toEqual([{ id: team, name: "5B Jackets Robinson" }]);
    expect(await myLeagueTeams(db.pool, "5550002")).toEqual([]);
  }, 120_000);

  it("its whole staff, from where it's kept: Head Coach first (verified ✓), then its other staff; an organization's from there", async () => {
    await db.pool.query("update users set verified_email = email where coach_id = '5550101'");
    await db.pool.query(
      `insert into scenic_team_staff (team_id, role, first_name, last_name, cell, added_by) values ($1, 'TeamParent', 'Tia', 'Park', '4235550909', 't'), ($1, 'AsstCoach', 'Al', 'Ash', '4235550808', 't')`,
      [team],
    );
    // An organization's team's League copy: its staff come from the organization (a Team Manager too).
    await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('chatt', 'City of Chattanooga', 'Chatt', 'Organization') on conflict do nothing");
    const ot = (
      await db.pool.query<{ id: string }>(
        "insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('chatt', '5B Chatt Lee', 'Boys', 5, 5, 'COMP', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query(
      "insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550002', 'Manager', 'x'), ($1, '5550101', 'HeadCoach', 'x')",
      [ot],
    );
    await db.pool.query(
      "insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values ('City of Chattanooga', 'Organization', false, true, true, 't', 'chatt')",
    );
    const copy = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_teams (name, gender, grade_low, grade, level, org_team_id, partner_id, coach_id, created_by, updated_by)
         select '5B Chatt Lee', 'Boys', 5, 5, 'COMP', $1, id, '5550101', 't', 't' from partners where org_slug = 'chatt' returning id::text`,
        [ot],
      )
    ).rows[0].id;
    const staff = await leagueStaff(db.pool, [team, copy]);
    expect(staff[team].map((m) => [m.role, m.first, m.verified, m.coachId])).toEqual([
      ["HeadCoach", "Ethan", true, "5550101"],
      ["AsstCoach", "Al", false, null],
      ["TeamParent", "Tia", false, null],
    ]);
    expect(staff[copy].map((m) => [m.role, m.first])).toEqual([
      ["HeadCoach", "Ethan"],
      ["Manager", "Sam"],
    ]);
  }, 120_000);

  it("Schedule requests: also the team's organization's Owners, Admins and Directors of Teams, and Scenic City's", async () => {
    await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('chatt', 'City of Chattanooga', 'Chatt', 'Organization') on conflict do nothing");
    await db.pool.query("insert into org_role_types (org, role) values ('chatt', 'Admin'), ('chatt', 'Director') on conflict do nothing");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550301', 'Ada', 'X', '4235550301'), ('5550302', 'Bo', 'X', '4235550302'),
         ('5550303', 'Cal', 'X', '4235550303'), ('5550304', 'Di', 'X', '4235550304')`,
    );
    await grant(db.pool, "5550301 chatt Admin", "5550302 chatt Director", "5550303 chatt Director", "5550304 scenic-city Admin");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('5550302', 'chatt', 'teams', 'test')");
    const ot = (
      await db.pool.query<{ id: string }>(
        "insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('chatt', '1B Chatt Lee', 'Boys', 1, 1, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query(
      "insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values ('City of Chattanooga', 'Organization', false, true, true, 't', 'chatt')",
    );
    const copy = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_teams (name, gender, grade_low, grade, level, org_team_id, partner_id, created_by, updated_by)
         select '1B Chatt Lee', 'Boys', 1, 1, 'REC', $1, id, 't', 't' from partners where org_slug = 'chatt' returning id::text`,
        [ot],
      )
    ).rows[0].id;
    const deps = { pool: db.pool, now: () => new Date("2026-11-23T17:00:00Z") };
    expect(await teamRequests(deps, person("5550301", "Ada"), copy)).not.toBeNull(); // its organization's Admin
    expect(await teamRequests(deps, person("5550302", "Bo"), copy)).not.toBeNull(); // its Director of Teams
    expect(await teamRequests(deps, person("5550303", "Cal"), copy)).toBeNull(); // a Director without Teams
    expect(await teamRequests(deps, person("5550304", "Di"), copy)).not.toBeNull(); // Scenic City's Admin
    expect(await teamRequests(deps, sam, copy)).toBeNull();
  }, 120_000);
});
