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
  }, 30_000);
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
    expect(made).toMatchObject({ ok: true, name: "4G Smith" });
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
    expect([t.name, t.coaches.map((c) => [c.name, c.email, c.cell])]).toEqual(["4G Clemons", [["Cindy Clemons", "cindy@example.com", "4235550123"]]]);
    expect((await db.pool.query("select updated_by from users where coach_id = '5550123'")).rows[0].updated_by).toBe("Jordan Harris");

    // A new cell nobody has: their login is made and they take the spot; the old coach loses the Coach role.
    expect(await edit(jo, { first: "Dana", last: "Moss", cell: "4235550456", email: "dana@example.com" })).toEqual({ ok: true, newLogin: true });
    t = await team();
    expect([t.name, t.coaches.map((c) => [c.id, c.role, c.email])]).toEqual(["4G Moss", [["5550456", "HeadCoach", "dana@example.com"]]]);
    expect([await hasRole("5550456", "Coach"), await hasRole("5550123", "Coach")]).toEqual([true, false]);

    // Someone who has a login (Pat): found by cell, their name updated, email kept when left blank.
    await db.pool.query("update users set email = 'pat@example.com' where coach_id = '5550007'");
    expect(
      await editTeamStaff(deps(), jo, org, id, { coachId: "5550456", role: "HeadCoach", first: "Patricia", last: "Lee", cell: "(423) 555-0007", email: "" }),
    ).toEqual({ ok: true, newLogin: false });
    t = await team();
    expect([t.name, t.coaches.map((c) => [c.id, c.name, c.email])]).toEqual(["4G Lee", [["5550007", "Patricia Lee", "pat@example.com"]]]);

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
    expect([t.name, t.coaches.map((c) => c.name).sort()]).toEqual(["4G Lee", ["Max Warden", "Patricia Lee"]]);
  });
});
