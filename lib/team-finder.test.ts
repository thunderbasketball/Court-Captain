import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findableTeams, searchTeams, type Findable } from "./team-finder";
import { createTestDb } from "./testing/db";

const t = (id: string, name: string, lasts: string[]): Findable => ({ id, name, group: "5th Boys COMP", org: "Hoops", orgSlug: null, lasts });

describe("find your team", () => {
  it("by the start of a coach's last name as they type, then by the team's name; never the coaches' names", () => {
    const teams = [t("1", "5B Bolts", ["O'Neal", "Van Dyke"]), t("2", "10B Neal", ["Neal"]), t("3", "5B Hawks", ["Smith-Jones"]), t("4", "5B Jones TBD", [])];
    const ids = (s: unknown) => searchTeams(teams, s).map((x) => x.id);
    expect(ids("o")).toEqual([]); // 2 letters or more
    expect(ids("  ")).toEqual([]);
    expect(ids(null)).toEqual([]);
    expect(ids("ONE")).toEqual(["1"]);
    expect(ids("o'neal")).toEqual(["1"]);
    expect(ids("dyk")).toEqual(["1"]);
    expect(ids("jon")).toEqual(["3", "4"]); // coach first, then the team's name
    expect(ids("5b haw")).toEqual(["3"]);
    expect(ids("%' or 1=1")).toEqual([]);
    expect(JSON.stringify(searchTeams(teams, "one"))).not.toMatch(/O'Neal|Van Dyke|lasts/);
    expect(searchTeams(Array.from({ length: 40 }, (_, i) => t(String(i), `5B Lee ${i}`, ["Lee"])), "lee")).toHaveLength(12);
  });

  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  it("teams in a current program, with their coaches from wherever they're kept; no simulated team or one sitting out", async () => {
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550002', 'Sam', 'Lee', '4235550002'), ('5550003', 'Bo', 'Fay', '4235550003');
       insert into organizations (slug, name, short_name, kind) values ('hoops', 'Hixson Hoops', 'Hoops', 'Organization');
       insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values ('Hixson Hoops', 'Organization', false, true, true, 't', 'hoops');
       insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('hoops', '5B Hoops Fay', 'Boys', 5, 5, 'COMP', 't');
       insert into org_team_coaches (team_id, coach_id, role, added_by, added_at) select id, '5550003', 'HeadCoach', 't', now() from org_teams;
       insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by) values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't');
       insert into scenic_divisions (program_id, gender, grade_low, grade_high) select id, 'Boys', 5, 5 from scenic_programs;
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;
       insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, org_team_id, created_by, updated_by) select 'Bolts', 'Boys', 5, 5, 'COMP', p.id, t.id, 't', 't' from partners p, org_teams t where p.org_slug = 'hoops';
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('Magic', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't'), ('Sim (DEV)', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't'), ('Out', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't');
       insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select p.id, t.id, po.id, 't' from scenic_programs p, scenic_teams t, scenic_pools po;
       update scenic_registrations set removed_by = 't' where team_id = (select id from scenic_teams where name = 'Out');`,
    );
    const list = await findableTeams(db.pool, new Date("2026-12-01T15:00:00Z"), "scenic-city");
    expect(list.map((x) => [x.name, x.org, x.orgSlug, x.lasts]).sort()).toEqual([
      ["Bolts", "Hixson Hoops", "hoops", ["Fay"]],
      ["Magic", null, null, ["Lee"]],
    ]);
    expect(searchTeams(list, "fay")).toEqual([{ id: expect.any(String), name: "Bolts", group: "5th Boys COMP", org: "Hixson Hoops", orgSlug: "hoops" }]);
    expect(await findableTeams(db.pool, new Date("2027-04-01T15:00:00Z"), "scenic-city")).toEqual([]); // over
  }, 60_000);
});
