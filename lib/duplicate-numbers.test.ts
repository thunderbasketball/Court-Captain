import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { directorAlerts } from "./director-alerts";
import { dupLabel, leagueDuplicates, orgDuplicates } from "./duplicate-numbers";
import { scorerCount, schedulerCount, setAssigner, setDirectorRoleActive } from "./org-admin";
import { orgMetrics } from "./org-metrics";
import { orgTeamWarnings } from "./team-warnings";
import { createTestDb, grant } from "./testing/db";
import { dupNumbers, isDup } from "./uniform-fields";

const now = new Date("2026-12-01T15:00:00Z");
const dee = { coachId: "9913694", firstName: "Dee", lastName: "X" } as SessionUser; // Owner of Scenic City

describe("duplicate uniform numbers", () => {
  it("07 is 7; 0 and 00 are different; blanks don't count", () => {
    expect(dupNumbers(["12", "2", "07", "7", "12", "12", null, "", undefined, "0", "00"])).toEqual(["7", "12"]);
    expect(isDup("07", ["7"])).toBe(true);
    expect(isDup("0", ["00"])).toBe(false);
    expect(isDup(null, ["7"])).toBe(false);
    expect(dupLabel(["7", "12"])).toBe("#7, #12");
  });

  let db: Awaited<ReturnType<typeof createTestDb>>;
  let deps: { pool: (typeof db)["pool"]; now: () => Date };
  beforeAll(async () => {
    db = await createTestDb();
    deps = { pool: db.pool, now: () => now };
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Dee', 'X', '4239913694'), ('5550003', 'Bo', 'Fay', '4235550003');
       insert into organizations (slug, name, short_name, kind) values ('club', 'Club', 'Club', 'Club');
       insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values ('Club', 'Organization', false, true, true, 't', 'club');
       insert into teams (name, gender, grades, grade_sort, level, created_by) values ('6B Lopez', 'Boys', '{6}', 6, 'COMP', 't'), ('5B Fine', 'Boys', '{5}', 5, 'COMP', 't');
       insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('club', '5G Club', 'Girls', 5, 5, 'COMP', 't');
       insert into org_team_players (team_id, first_name, last_name, grade, jersey, added_by) select id, f, 'Z', 5, j, 't' from org_teams, (values ('Ava', '4'), ('Bea', '4')) v(f, j);
       insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by) values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't');
       insert into scenic_divisions (program_id, gender, grade_low, grade_high) select id, 'Boys', 5, 6 from scenic_programs;
       insert into scenic_grade_groups (division_id, grade, level) select id, 6, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;
       insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, thunder_team_id, created_by, updated_by)
         select '6B TB Lopez', 'Boys', 6, 6, 'COMP', p.id, t.id, 't', 't' from partners p, teams t where p.org_slug = 'club' and t.name = '6B Lopez';
       insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, org_team_id, created_by, updated_by)
         select '5G Club', 'Girls', 5, 5, 'COMP', p.id, t.id, 't', 't' from partners p, org_teams t where p.org_slug = 'club';
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('Solo', 'Boys', 6, 6, 'COMP', '5550003', '5550003', 't', 't'), ('Sim (DEV)', 'Boys', 6, 6, 'COMP', '5550003', '5550003', 't', 't'), ('Out', 'Boys', 6, 6, 'COMP', '5550003', '5550003', 't', 't');
       insert into scenic_team_players (team_id, first_name, last_name, jersey, added_by) select id, f, 'Y', '9', 't' from scenic_teams, (values ('Al'), ('Bo')) v(f) where owner_coach_id is not null;
       insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select p.id, t.id, po.id, 't' from scenic_programs p, scenic_teams t, scenic_pools po;
       update scenic_registrations set removed_by = 't' where team_id = (select id from scenic_teams where name = 'Out');`,
    );
    for (const [id, team, number] of [["a", "6B Lopez", "12"], ["b", "6B Lopez", "12"], ["c", "6B Lopez", "2"], ["d", "5B Fine", "12"], ["e", "5B Fine", "1"]] as const) {
      await db.pool.query(
        `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
         select id, $1, 'K', 'L', 'Boys', '6', 6, 't', now() from teams where name = $2`,
        [id, team],
      );
      await db.pool.query("insert into team_uniforms (team_id, registrant_id, number, updated_by, updated_at) select id, $1, $3, 't', now() from teams where name = $2", [id, team, number]);
    }
    await grant(db.pool, "9913694 scenic-city Owner", "9913694 scenic-city Admin", "9913694 scenic-city Director");
  }, 180_000);
  afterAll(async () => db?.drop());

  it("an organization's own teams, and a League's registered teams from wherever their roster is kept", async () => {
    const list = (x: { name: string; numbers: string[] }[]) => x.map((t) => [t.name, t.numbers.join()]);
    expect(list(await orgDuplicates(db.pool, "thunder"))).toEqual([["6B Lopez", "12"]]);
    expect(list(await orgDuplicates(db.pool, "club"))).toEqual([["5G Club", "4"]]);
    const league = [["5G Club", "4"], ["6B TB Lopez", "12"], ["Solo", "9"]];
    expect(list(await leagueDuplicates(db.pool, { org: "scenic-city", today: "2026-12-01" }))).toEqual(league);
    expect(list(await leagueDuplicates(db.pool, { org: "scenic-city", today: "2027-04-01" }))).toEqual([]); // over
    const ids = (await db.pool.query<{ id: string }>("select id::text from scenic_teams where name = 'Solo'")).rows.map((r) => r.id);
    expect(list(await leagueDuplicates(db.pool, { ids }))).toEqual([["Solo", "9"]]);
    // Everyone who should know: Thunder's Teams and Uniforms flash, Warnings list it, the League's To Do has it.
    expect(await directorAlerts(db.pool, now)).toMatchObject({ teams: true, uniforms: true });
    expect((await orgTeamWarnings(db.pool, "club", now)).duplicates).toMatchObject([{ name: "5G Club", detail: "#4" }]);
    expect(list((await orgMetrics(deps, dee, "scenic-city"))!.duplicates)).toEqual(league);
  }, 60_000);

  it("CourtEvents needs a Director of Scheduling by name: warned to its Owners and Admins until there is one", async () => {
    const needed = async () => (await orgMetrics(deps, dee, "scenic-city"))!.missingRoles.map((r) => r.area);
    expect(await scorerCount(db.pool, "scenic-city")).toBeNull(); // it hosts no games
    expect(await schedulerCount(db.pool, "club")).toBeNull(); // no CourtEvents
    expect(await schedulerCount(db.pool, "scenic-city")).toBe(0);
    expect(await needed()).toEqual(["scheduling"]);
    expect(await setAssigner(deps, dee, "club", "9913694", true, "scheduling")).toMatchObject({ ok: false });
    expect(await setAssigner(deps, dee, "scenic-city", "9913694", true, "scheduling")).toEqual({ ok: true }); // the Owner, by name
    expect(await needed()).toEqual([]);
    await setDirectorRoleActive(deps, dee, "scenic-city", "scheduling", false);
    expect(await needed()).toEqual(["scheduling"]);
    await setDirectorRoleActive(deps, dee, "scenic-city", "scheduling", true);
    expect(await setAssigner(deps, dee, "scenic-city", "9913694", false, "scheduling")).toEqual({ ok: true });
    expect(await needed()).toEqual(["scheduling"]);
  }, 60_000);
});
