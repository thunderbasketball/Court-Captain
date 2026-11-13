import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, grant } from "./testing/db";
import { gymScoresheets } from "./scoresheets";

describe("printable scoresheets", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool });
  const person = (coachId: string) => ({ coachId, firstName: "P", lastName: "X", isDirector: false }) as never;
  const fay = person("5550004");
  let gym = "";

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550004', 'Fay', 'X', '4235550004'),
         ('5550002', 'Sam', 'Lee', '4235550002'), ('5550003', 'Bo', 'Fay', '4235550003')`,
    );
    await grant(db.pool, "5550004 scenic-city Director");
    const prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter League', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query("insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values ('Baylor School', 'School', true, false, true, 't')");
    gym = (
      await db.pool.query<{ id: string }>(
        "insert into partner_gyms (partner_id, name, address, created_by) select id, 'Main Gym', '171 Baylor School Rd', 't' from partners returning id::text",
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into partner_courts (gym_id, name, created_by) values (${gym}, 'Court 1', 't'), (${gym}, 'Court 2', 't');
       insert into game_days (day, created_by) values ('2026-12-05', 't');
       insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 5, 6);
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;
       insert into org_teams (org, name, gender, grade_low, grade, level, created_by)
         select slug, 'Hawks 5B', 'Boys', 5, 5, 'COMP', 't' from organizations where slug = 'scenic-city';
       insert into org_team_players (team_id, first_name, last_name, grade, jersey, added_by)
         select id, 'Zed', 'Adams', 5, '23', 't' from org_teams union all select id, 'Al', 'Brown', 5, '4', 't' from org_teams
         union all select id, 'Cy', 'Cole', 5, null, 't' from org_teams;
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by, org_team_id)
         select 'Hawks 5B', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't', id from org_teams;
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('Magic', 'Boys', 5, 5, 'COMP', '5550003', '5550003', 't', 't'), ('Solo', 'Boys', 5, 5, 'COMP', '5550003', '5550003', 't', 't');
       insert into scenic_registrations (program_id, team_id, pool_id, registered_by)
         select ${prog}, t.id, (select id from scenic_pools), 't' from scenic_teams t;`,
    );
    const team = async (n: string) => (await db.pool.query<{ id: string }>("select id::text from scenic_teams where name = $1", [n])).rows[0].id;
    const court = async (n: string) => (await db.pool.query<{ id: string }>("select id::text from partner_courts where name = $1", [n])).rows[0].id;
    const [hawks, magic, solo, c1, c2] = [await team("Hawks 5B"), await team("Magic"), await team("Solo"), await court("Court 1"), await court("Court 2")];
    const [a, b] = [hawks, magic].sort((x, y) => Number(x) - Number(y));
    await db.pool.query(
      `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by, home_side, court_key, starts)
       select $1, id, '2026-12-05', $2, $3, 't', $4, $5, '10:00' from scenic_divisions`,
      [prog, a, b, a === hawks ? "a" : "b", c2],
    );
    await db.pool.query(
      `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by, court_key, starts)
       select $1, id, '2026-12-05', $2, null, 't', $3, '09:00' from scenic_divisions`,
      [prog, solo, c1],
    );
  });

  it("a page per game at the gym, by court then time, with Home/Away, coaches and rosters by jersey; Schedulers only", async () => {
    expect(await gymScoresheets(deps(), fay, "2026-12-05", `p${gym}`)).toBeNull(); // not a Scheduler yet
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'scenic-city', 'scheduling', 't')");
    expect(await gymScoresheets(deps(), fay, "2026-12-5", `p${gym}`)).toBeNull();
    expect(await gymScoresheets(deps(), fay, "2026-12-05", "x1")).toBeNull();
    const r = (await gymScoresheets(deps(), fay, "2026-12-05", `p${gym}`))!;
    expect(r).toMatchObject({ gym: "Main Gym", host: "Baylor School", date: "2026-12-05" });
    expect(r.sheets.map((s) => [s.court, s.starts, s.home?.name ?? "TBD", s.away?.name ?? "TBD"])).toEqual([
      ["Court 1", "09:00", "Solo", "TBD"],
      ["Court 2", "10:00", "Hawks 5B", "Magic"],
    ]);
    expect(r.sheets[1]).toMatchObject({ league: "Winter League", division: "Boys 5th–6th", minutes: 55, address: "171 Baylor School Rd" });
    expect(r.sheets[1].home).toEqual({
      name: "Hawks 5B",
      coach: "Sam Lee",
      players: [
        { jersey: "4", name: "Al Brown" },
        { jersey: "23", name: "Zed Adams" },
        { jersey: null, name: "Cy Cole" },
      ],
    });
    expect(r.sheets[1].away).toEqual({ name: "Magic", coach: "Bo Fay", players: [] });
    expect((await gymScoresheets(deps(), fay, "2026-12-12", `p${gym}`))!.sheets).toEqual([]);
  });
});
