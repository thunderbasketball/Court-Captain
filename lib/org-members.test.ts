import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminCanSee, type SessionUser } from "./auth/service";
import { listOrgMembers } from "./org-members";
import { createOrganization } from "./org-signup";
import { createOrgTeam } from "./org-teams";
import { createTestDb } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const owner = person("5550001", "Jo");
const teamsDirector = person("5550002", "Bo");
const outsider = person("5550003", "Cy");
const org = "east-ridge-parks-and-rec";

describe("a registered organization's Members", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-03T15:00:00Z") });

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jo', 'X', '4235550001'),
         ('5550002', 'Bo', 'X', '4235550002'), ('5550003', 'Cy', 'X', '4235550003')`,
    );
    const input = { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e" };
    await createOrganization(deps(), owner, { ...input, features: ["court-org"] }, null);
    await db.pool.query("select set_role('5550002', $1, 'Director', true, 'test')", [org]);
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('5550002', $1, 'teams', 'test')", [
      org,
    ]);
  });

  it("lists its people like Thunder's (role, coach, teams); Admins and Directors of Teams only; Admins view as them", async () => {
    const t = await createOrgTeam(deps(), owner, org, {
      gender: "Girls",
      grades: ["5"],
      level: "REC",
      headCoach: { first: "Sam", last: "Lee", cell: "4235550009" },
    } as Parameters<typeof createOrgTeam>[3]);
    expect(t).toMatchObject({ ok: true, name: "5G Lee" });

    const list = await listOrgMembers(db.pool, owner, org);
    expect(list!.admin).toBe(true);
    expect(list!.users.map((u) => [u.firstName, u.director, u.coach, u.teams])).toEqual([
      ["Sam", false, true, ["5G Lee · Head Coach"]],
      ["Bo", true, false, []],
      ["Jo", true, false, []],
    ]);
    // Each team spot with its team (the pill opens it; Members → Coaches groups by its gender and grade).
    const t5 = (t as { id: string }).id;
    expect(list!.users[0].teamLinks).toEqual([{ id: t5, label: "5G Lee · Head Coach", gender: "Girls", grade: 5 }]);
    expect(list!.users[1].teamLinks).toEqual([]);
    expect((await listOrgMembers(db.pool, teamsDirector, org))!.admin).toBe(false);
    expect(await listOrgMembers(db.pool, outsider, org)).toBeNull();
    expect(await listOrgMembers(db.pool, owner, "thunder")).toBeNull();

    // View as: the Owner (an Admin) sees the coach and the Director; a Director of Teams doesn't; no one outside it.
    expect(await adminCanSee(db.pool, owner.coachId, "5550009")).toBe(true);
    expect(await adminCanSee(db.pool, owner.coachId, teamsDirector.coachId)).toBe(true);
    expect(await adminCanSee(db.pool, teamsDirector.coachId, "5550009")).toBe(false);
    expect(await adminCanSee(db.pool, owner.coachId, outsider.coachId)).toBe(false);
  });
});
