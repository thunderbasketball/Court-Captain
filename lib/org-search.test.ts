import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { createOrganization } from "./org-signup";
import { searchOrg, searchWords } from "./org-search";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string, lastName: string): SessionUser => ({
  coachId,
  firstName,
  lastName,
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const admin = person("9913694", "Dee", "Admin"); // Thunder Admin
const dir = person("5550010", "Dan", "Dir"); // Thunder Director, not an Admin
const coach = person("5550001", "Cal", "Smith"); // Thunder Head Coach only
const jo = person("5550020", "Jordan", "Harris"); // Owner of East Ridge
const org = "east-ridge-parks-and-rec";

describe("Home search", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-05T15:00:00Z") });

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell, email) values
         ('9913694', 'Dee', 'Admin', '4235559999', null), ('5550010', 'Dan', 'Dir', '4235550010', null),
         ('5550001', 'Cal', 'Smith', '4235550001', 'cal@example.com'), ('5550002', 'Sam', 'Smithers', '4235550002', null),
         ('5550020', 'Jordan', 'Harris', '4235550020', null), ('5550021', 'Sue', 'Smith', '4235550021', null)
       on conflict (coach_id) do nothing`,
    );
    await grant(
      db.pool,
      "9913694 thunder Director",
      "9913694 thunder Admin",
      "5550010 thunder Director",
      "5550001 thunder Coach",
    );
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Smith', 'Girls', '{4}', 4, 'REC', 'x')
       returning id::text`,
    );
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x')", [
      t.rows[0].id,
    ]);
    await db.pool.query(
      `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw,
                                  imported_at, imported_by, parent1_first, parent1_last, parent1_cell, parent1_email)
       values ('r1', 'r1', 'Ava', 'Smith', 'Girls', '4', 4, 'x', '{}', now(), 'x', 'Pat', 'Smith', '(423) 555-0303', 'pat@example.com'),
              ('r2', 'r2', 'Bo', 'Jones', 'Boys', 'K', 0, 'x', '{}', now(), 'x', null, null, null, null)`,
    );
    await db.pool.query(
      "insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at) values ($1, 'r1', 'Ava', 'Smith', 'Girls', '4', 4, 'x', now())",
      [t.rows[0].id],
    );
    // East Ridge: Jordan is its Owner; Sue Smith coaches one of its teams, which has a player Ava Smithson.
    await createOrganization(
      deps(),
      jo,
      { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e", features: ["court-club"] },
      null,
    );
    const o = await db.pool.query<{ id: string }>(
      `insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ($1, '5B Smith', 'Boys', 5, 5, 'REC', 'x')
       returning id::text`,
      [org],
    );
    await db.pool.query(
      "insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550021', 'HeadCoach', 'x')",
      [o.rows[0].id],
    );
    await db.pool.query(
      "insert into org_team_players (team_id, first_name, last_name, grade, added_by) values ($1, 'Ava', 'Smithson', 5, 'x')",
      [o.rows[0].id],
    );
  });

  it("Owners, Admins and Directors only; each word anywhere in a name", async () => {
    expect(await searchOrg(deps(), coach, "thunder", "smith")).toBeNull(); // a coach can't search
    expect(await searchOrg(deps(), jo, "thunder", "smith")).toBeNull(); // another organization's Owner can't search Thunder
    expect(await searchOrg(deps(), admin, "not a slug!", "smith")).toBeNull();
    expect(await searchOrg(deps(), dir, "thunder", "s")).toEqual({ coaches: [], players: [], things: [] }); // too short
    expect(searchWords("%%")).toEqual(["%\\%\\%%"]); // typed % and _ are matched as themselves
    expect(searchWords("(423) 555-03")).toEqual(["%423%", "%55503%"]); // a cell typed any way: its digits

    const r = await searchOrg(deps(), dir, "thunder", "smi");
    // Cal (Thunder role + team); Sam Smithers has no Thunder role or team; Sue Smith is East Ridge's.
    expect(r?.coaches.map((c) => c.name)).toEqual(["Cal Smith"]);
    expect(r?.coaches[0]).toMatchObject({
      cell: "4235550001",
      email: "cal@example.com",
      roles: ["Coach"],
      teams: [{ name: "4G Smith", role: "Head Coach" }],
      dashboard: null, // a Director (not an Admin) doesn't get their dashboard
    });
    expect(r?.players).toEqual([
      expect.objectContaining({
        name: "Ava Smith",
        detail: "Girls · 4th Grade",
        team: expect.objectContaining({ name: "4G Smith" }),
        parents: [{ name: "Pat Smith", cell: "4235550303", email: "pat@example.com" }],
      }),
    ]);
    expect((await searchOrg(deps(), dir, "thunder", "ava sm"))?.players.map((p) => p.name)).toEqual(["Ava Smith"]);
    expect((await searchOrg(deps(), dir, "thunder", "bo"))?.players[0]).toMatchObject({
      name: "Bo Jones",
      team: null,
      parents: [],
    });
    expect((await searchOrg(deps(), admin, "thunder", "cal"))?.coaches[0].dashboard).toBe("/me/5550001");
  });

  it("finds anything: partial cells, emails, parents' names and cells, teams, gyms, programs, scrimmages", async () => {
    const names = async (q: string) => {
      const r = (await searchOrg(deps(), dir, "thunder", q))!;
      return { coaches: r.coaches.map((c) => c.name), players: r.players.map((p) => p.name), things: r.things.map((t) => `${t.kind} ${t.name}`) };
    };
    expect((await names("555-0001")).coaches).toEqual(["Cal Smith"]); // part of a cell
    expect((await names("cal@exa")).coaches).toEqual(["Cal Smith"]); // part of an email
    expect((await names("pat")).players).toEqual(["Ava Smith"]); // a parent's first name finds their player
    expect((await names("(423) 555-03")).players).toEqual(["Ava Smith"]); // a parent's cell, typed any way
    expect((await names("ith")).coaches).toEqual(["Cal Smith"]); // any part of a name
    expect((await names("4g smi")).things).toEqual(["team 4G Smith"]);
    await db.pool.query("insert into gyms (name, address) values ('Action Church', '123 Main St')");
    const prog = await db.pool.query<{ id: string }>(
      "insert into player_programs (org, name, reg_opens, created_by) values ('thunder', 'Winter 26/27', '2026-10-01', 'x') returning id::text",
    );
    await db.pool.query(
      `insert into scrimmages (org, program_id, home_thunder_team_id, away_name, starts_at, minutes, place, added_by)
       select 'thunder', $1, id, 'Signal Mountain', '2026-11-14T15:00:00Z', 60, 'Action Church', 'x' from teams where name = '4G Smith'`,
      [prog.rows[0].id],
    );
    expect((await names("main st")).things).toEqual(["gym Action Church"]);
    expect((await names("winter")).things).toEqual(["program Winter 26/27"]);
    expect((await names("signal")).things).toEqual(["scrimmage 4G Smith vs Signal Mountain"]);
    expect((await names("action")).things).toEqual(["scrimmage 4G Smith vs Signal Mountain", "gym Action Church"]);
  });

  it("another organization finds only its own coaches and players", async () => {
    const r = await searchOrg(deps(), jo, org, "smith");
    expect(r?.coaches.map((c) => c.name)).toEqual(["Sue Smith"]);
    expect(r?.coaches[0].teams).toEqual([
      { name: "5B Smith", role: "Head Coach", href: expect.stringMatching(`^/org/${org}/teams/`) },
    ]);
    expect(r?.players).toEqual([expect.objectContaining({ name: "Ava Smithson", detail: "Boys · 5th Grade" })]);
    expect(await searchOrg(deps(), dir, org, "smith")).toBeNull(); // a Thunder Director isn't East Ridge's
  });
});
