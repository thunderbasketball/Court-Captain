import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { createOrganization } from "./org-signup";
import { addOrgTeamCoach, createOrgTeam, deleteOrgTeam, getOrgTeam, listOrgTeams, removeOrgTeamCoach } from "./org-teams";
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

describe("teams for a registered organization", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-02T15:00:00Z") });
  const hasRole = async (coachId: string, role: string) =>
    (await db.pool.query<{ ok: boolean }>("select has_role($1, $2, $3) as ok", [coachId, org, role])).rows[0].ok;

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jordan', 'Harris', '4235550001')",
    );
    const input = { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e" };
    await createOrganization(deps(), jo, { ...input, features: ["team-building"] }, null);
  });

  it("Admins add teams (sorted, names unique), coaches by cell (login made, Coach role), and remove them", async () => {
    expect(await createOrgTeam(deps(), jo, org, { name: "Rockets", gender: "Girls", grade: "5", level: "REC" })).toMatchObject({
      ok: true,
    });
    const b = await createOrgTeam(deps(), jo, org, { name: "Bolts", gender: "Boys", grade: "3-4", level: "COMP" });
    expect(b).toMatchObject({ ok: true });
    const id = (b as { id: string }).id;
    expect(await createOrgTeam(deps(), jo, org, { name: "bolts", gender: "Boys", grade: "4", level: "REC" })).toEqual({
      ok: false,
      message: "There's already a team with that name.",
    });
    expect(await createOrgTeam(deps(), jo, org, { name: "=cmd", gender: "Boys", grade: "4", level: "REC" })).toMatchObject({
      ok: false,
    });
    expect(await createOrgTeam(deps(), jo, org, { name: "X", gender: "Boys", grade: "4-6", level: "REC" })).toMatchObject({
      ok: false,
    });

    // A new coach: their login is made and they get the Coach role here.
    const coach = { first: "Sam", last: "Lee", cell: "(423) 555-0009", role: "HeadCoach" };
    expect(await addOrgTeamCoach(deps(), jo, org, id, coach)).toEqual({ ok: true, name: "Sam Lee", newLogin: true });
    expect(await hasRole("5550009", "Coach")).toBe(true);
    expect(await addOrgTeamCoach(deps(), jo, org, id, { ...coach, first: "Pat", cell: "4235550008" })).toMatchObject({
      ok: false,
      message: "This team already has a Head Coach. Remove them first.",
    });
    expect(await addOrgTeamCoach(deps(), jo, org, id, { ...coach, role: "AsstCoach" })).toMatchObject({ ok: false });
    expect(
      await addOrgTeamCoach(deps(), jo, org, id, { ...coach, first: "Pat", cell: "4235550008", role: "AsstCoach" }),
    ).toMatchObject({ ok: true });

    const list = (await listOrgTeams(deps(), jo, org))!;
    expect(list.canManage).toBe(true);
    expect(list.teams.map((t) => `${t.gender} ${t.grade} ${t.level} ${t.name}`)).toEqual([
      "Boys 3rd/4th COMP Bolts",
      "Girls 5th REC Rockets",
    ]);
    expect(list.teams[0].coaches.map((c) => `${c.name} ${c.role} by ${c.addedBy}`)).toEqual([
      "Sam Lee HeadCoach by Jordan Harris",
      "Pat Lee AsstCoach by Jordan Harris",
    ]);

    // A coach sees only their teams, and can't change them.
    const sam = { ...jo, coachId: "5550009", firstName: "Sam", lastName: "Lee" };
    expect((await listOrgTeams(deps(), sam, org))!).toMatchObject({ canManage: false, teams: [{ name: "Bolts" }] });
    expect(await getOrgTeam(deps(), sam, org, id)).toMatchObject({ canManage: false, team: { name: "Bolts" } });
    expect(await createOrgTeam(deps(), sam, org, { name: "Mine", gender: "Boys", grade: "4", level: "REC" })).toMatchObject({
      ok: false,
    });
    expect(await removeOrgTeamCoach(deps(), sam, org, id, "5550008")).toMatchObject({ ok: false });
    // Someone with no role there sees nothing.
    expect(await listOrgTeams(deps(), { ...jo, coachId: "5550007" }, org)).toBeNull();

    // Removing the last team a coach is on takes their Coach role away.
    expect(await removeOrgTeamCoach(deps(), jo, org, id, "5550009")).toEqual({ ok: true });
    expect(await hasRole("5550009", "Coach")).toBe(false);
    expect(await deleteOrgTeam(deps(), jo, org, id)).toEqual({ ok: true });
    expect(await hasRole("5550008", "Coach")).toBe(false);
    expect((await listOrgTeams(deps(), jo, org))!.teams.map((t) => t.name)).toEqual(["Rockets"]);
  });

  it("needs Team Management, and isn't for Thunder or Scenic City", async () => {
    await db.pool.query("delete from org_features where org = $1 and feature = 'team-building'", [org]);
    expect(await listOrgTeams(deps(), jo, org)).toBeNull();
    expect(await createOrgTeam(deps(), jo, org, { name: "A", gender: "Boys", grade: "4", level: "REC" })).toMatchObject({
      ok: false,
    });
    expect(await listOrgTeams(deps(), jo, "thunder")).toBeNull();
  });
});
