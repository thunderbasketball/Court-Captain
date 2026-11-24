import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { createOrganization } from "./org-signup";
import { addOrgTeamCoach, createOrgTeam, getOrgTeam } from "./org-teams";
import { editTeamStaff } from "./head-coach";
import { createTestDb } from "./testing/db";

const jo: SessionUser = {
  coachId: "5550001",
  firstName: "Jordan",
  lastName: "Harris",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
};
const org = "east-ridge-parks-and-rec";

describe("Owners and Admins edit a team's Head Coach", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-16T15:00:00Z") });

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jordan', 'Harris', '4235550001')",
    );
    const input = { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e" };
    await createOrganization(deps(), jo, { ...input, features: ["court-club"] }, null);
  });

  const hasRole = async (coachId: string, role: string) =>
    (await db.pool.query<{ ok: boolean }>("select has_role($1, $2, $3) as ok", [coachId, org, role])).rows[0].ok;

  it("edits name, cell and email; a new cell finds or makes the person; only Owners and Admins", async () => {
    const made = await createOrgTeam(deps(), jo, org, {
      gender: "Girls",
      grades: ["4"],
      level: "COMP",
      headCoach: { first: "Cindy", last: "Smith", cell: "4235550123" },
    });
    expect(made).toMatchObject({ ok: true, name: "4G East Ridge Smith" });
    const id = (made as { id: string }).id;
    const edit = (who: SessionUser, input: Record<string, unknown>) =>
      editTeamStaff(deps(), who, org, id, { coachId: "5550123", role: "HeadCoach", first: "Cindy", last: "Clemons", cell: "4235550123", email: "", ...input });
    const team = async () => (await getOrgTeam(deps(), jo, org, id))!.team;

    // Not an Owner or Admin here: refused.
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550007', 'Pat', 'Lee', '4235550007')");
    expect(await edit({ ...jo, coachId: "5550007" }, {})).toMatchObject({ ok: false, message: expect.stringContaining("Owner or Admin") });
    // Bad input.
    expect(await edit(jo, { first: "" })).toMatchObject({ ok: false });
    expect(await edit(jo, { last: "=cmd()" })).toMatchObject({ ok: false });
    expect(await edit(jo, { email: "nope" })).toMatchObject({ ok: false });
    expect(await edit(jo, { cell: "123" })).toMatchObject({ ok: false });
    expect(await edit(jo, { role: "AsstCoach" })).toMatchObject({ ok: false }); // not in that spot

    // Same cell: name and email; the team follows the last name.
    expect(await edit(jo, { email: "Cindy@Example.com" })).toEqual({ ok: true, newLogin: false });
    let t = await team();
    expect([t.name, t.coaches.map((c) => [c.name, c.email, c.cell])]).toEqual(["4G East Ridge Clemons", [["Cindy Clemons", "cindy@example.com", "4235550123"]]]);
    expect((await db.pool.query("select updated_by from users where coach_id = '5550123'")).rows[0].updated_by).toBe("Jordan Harris");

    // A new cell nobody has: their login is made and they take the spot; the old coach loses the Coach role.
    expect(await edit(jo, { first: "Dana", last: "Moss", cell: "4235550456", email: "dana@example.com" })).toEqual({ ok: true, newLogin: true });
    t = await team();
    expect([t.name, t.coaches.map((c) => [c.id, c.role, c.email])]).toEqual(["4G East Ridge Moss", [["5550456", "HeadCoach", "dana@example.com"]]]);
    expect([await hasRole("5550456", "Coach"), await hasRole("5550123", "Coach")]).toEqual([true, false]);

    // Someone who has a login (Pat): found by cell, their name updated, email kept when left blank.
    await db.pool.query("update users set email = 'pat@example.com' where coach_id = '5550007'");
    expect(
      await editTeamStaff(deps(), jo, org, id, { coachId: "5550456", role: "HeadCoach", first: "Patricia", last: "Lee", cell: "(423) 555-0007", email: "" }),
    ).toEqual({ ok: true, newLogin: false });
    t = await team();
    expect([t.name, t.coaches.map((c) => [c.id, c.name, c.email])]).toEqual(["4G East Ridge Lee", [["5550007", "Patricia Lee", "pat@example.com"]]]);

    // A Team Manager's row edits the same way; a person already on the staff can't take a second spot here.
    expect(await addOrgTeamCoach(deps(), jo, org, id, { first: "Max", last: "Ward", cell: "4235550201", role: "Manager" })).toMatchObject({ ok: true });
    expect(await editTeamStaff(deps(), jo, org, id, { coachId: "5550201", role: "Manager", first: "Max", last: "Warden", cell: "4235550201", email: "" })).toEqual({
      ok: true,
      newLogin: false,
    });
    expect(
      await editTeamStaff(deps(), jo, org, id, { coachId: "5550201", role: "Manager", first: "Patricia", last: "Lee", cell: "4235550007", email: "" }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("already on this team's staff") });
    t = await team();
    expect([t.name, t.coaches.map((c) => c.name).sort()]).toEqual(["4G East Ridge Lee", ["Max Warden", "Patricia Lee"]]);
  });

  it("switches roles: Head Coach to Assistant leaves TBD; another becomes Head Coach; Coach role follows; Thunder too", async () => {
    const made = (await createOrgTeam(deps(), jo, org, {
      gender: "Girls",
      grades: ["4"],
      level: "COMP",
      headCoach: { first: "Cindy", last: "Smith", cell: "4235550123" },
    })) as { id: string };
    const id = made.id;
    expect(await addOrgTeamCoach(deps(), jo, org, id, { first: "Ann", last: "Bell", cell: "4235550301", role: "TeamParent" })).toMatchObject({ ok: true });
    const sw = (coachId: string, role: string, newRole: string, first: string, last: string, cell: string) =>
      editTeamStaff(deps(), jo, org, id, { coachId, role, newRole, first, last, cell, email: "" });
    const team = async () => (await getOrgTeam(deps(), jo, org, id))!.team;
    // A second Head Coach is refused while there is one.
    expect(await sw("5550301", "TeamParent", "HeadCoach", "Ann", "Bell", "4235550301")).toMatchObject({
      ok: false,
      message: expect.stringContaining("already has a Head Coach (Cindy Smith)"),
    });
    expect(await sw("5550301", "TeamParent", "Boss", "Ann", "Bell", "4235550301")).toMatchObject({ ok: false });
    // Head Coach → Assistant: the team is TBD; its League copy has no coach.
    await db.pool.query(
      "insert into scenic_teams (name, gender, grade_low, grade, level, coach_id, created_by, updated_by, org_team_id, owner_coach_id) values ('ER 4G Smith', 'Girls', 4, 4, 'COMP', '5550123', 't', 't', $1, '5550001')",
      [id],
    );
    expect(await sw("5550123", "HeadCoach", "AsstCoach", "Cindy", "Smith", "4235550123")).toMatchObject({ ok: true });
    let t = await team();
    expect([t.name, t.coaches.map((c) => [c.name, c.role]).sort()]).toEqual(["4G East Ridge TBD", [["Ann Bell", "TeamParent"], ["Cindy Smith", "AsstCoach"]]]);
    expect((await db.pool.query("select coach_id from scenic_teams where org_team_id = $1", [id])).rows[0].coach_id).toBeNull();
    expect(await hasRole("5550123", "Coach")).toBe(true);
    // Team Parent → Head Coach: renamed for her; she gets the Coach role; the League copy follows.
    expect(await sw("5550301", "TeamParent", "HeadCoach", "Ann", "Bell", "4235550301")).toMatchObject({ ok: true });
    t = await team();
    expect(t.name).toBe("4G East Ridge Bell");
    expect(await hasRole("5550301", "Coach")).toBe(true);
    expect((await db.pool.query("select coach_id from scenic_teams where org_team_id = $1", [id])).rows[0].coach_id).toBe("5550301");
    // Assistant → Team Manager: no longer a coach anywhere here, so the Coach role goes.
    expect(await sw("5550123", "AsstCoach", "Manager", "Cindy", "Smith", "4235550123")).toMatchObject({ ok: true });
    expect(await hasRole("5550123", "Coach")).toBe(false);

    // Thunder: one person per role; Head Coach → Assistant leaves TBD.
    await db.pool.query("select set_role('5550001', 'thunder', 'Admin', true, 'test')");
    const th = (
      await db.pool.query<{ id: string }>(
        "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('5B Smith', 'Boys', '{5}', 5, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550123', 'HeadCoach', 'x'), ($1, '5550301', 'AsstCoach', 'x')", [th]);
    const tsw = (coachId: string, role: string, newRole: string, first: string, last: string, cell: string) =>
      editTeamStaff(deps(), jo, "thunder", th, { coachId, role, newRole, first, last, cell, email: "" });
    expect(await tsw("5550123", "HeadCoach", "AsstCoach", "Cindy", "Smith", "4235550123")).toMatchObject({ ok: false, message: expect.stringContaining("already has a Assistant Coach") });
    expect(await tsw("5550123", "HeadCoach", "Manager", "Cindy", "Smith", "4235550123")).toMatchObject({ ok: true });
    expect((await db.pool.query("select name from teams where id = $1", [th])).rows[0].name).toBe("5B TBD");
    expect(await tsw("5550301", "AsstCoach", "HeadCoach", "Ann", "Bell", "4235550301")).toMatchObject({ ok: true });
    expect((await db.pool.query("select name from teams where id = $1", [th])).rows[0].name).toBe("5B Bell");
  });
});
