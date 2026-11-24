import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addOrgPlayer, importOrgPlayers, importPlayerRows, listOrgRoster, previewPlayerRows, setOrgPlayerBirthdate } from "./org-rosters";
import { createOrganization } from "./org-signup";
import { createOrgTeam, setOrgTeamAltNames } from "./org-teams";
import { orgTeamWarnings } from "./team-warnings";
import { createTestDb } from "./testing/db";

const jo: SessionUser = {
  coachId: "5550001",
  firstName: "Jo",
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
};
const org = "east-ridge-parks-and-rec";

describe("typed-in rosters: birthdates", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const now = new Date("2026-11-02T15:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jo', 'X', '4235550001')");
    await createOrganization(
      deps(),
      jo,
      { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e", features: ["court-club"] },
      null,
    );
  });

  it("asked when adding or importing; missing ones are warned about until filled in", async () => {
    const tid = ((await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: ["4"], level: "COMP" })) as { id: string }).id;
    expect(await addOrgPlayer(deps(), jo, org, tid, { first: "Ava", last: "Smith", grade: "4", birthdate: "2/30/2016" })).toEqual({
      ok: false,
      message: "Birthdate: a date like 5/3/2014",
    });
    expect(await addOrgPlayer(deps(), jo, org, tid, { first: "Ava", last: "Smith", grade: "4", birthdate: "5/3/2016" })).toMatchObject({ ok: true });
    // Import: the 5th column; a row without one is added (and warned about).
    expect(await importOrgPlayers(deps(), jo, org, tid, "First,Last,Grade,Jersey,Birthdate\nLiam,Jones,4,,2015-09-21\nNoah,Lee,4,7,")).toMatchObject({
      ok: true,
      added: ["Liam Jones", "Noah Lee"],
    });
    const roster = (await listOrgRoster(deps(), jo, org, tid))!.players;
    // By jersey number (Noah #7), then those without one by last name.
    expect(roster.map((p) => [p.first, p.birthdate, p.birthdateBy])).toEqual([
      ["Noah", null, null],
      ["Liam", "2015-09-21", "Jo X"],
      ["Ava", "2016-05-03", "Jo X"],
    ]);
    const w = await orgTeamWarnings(db.pool, org, now);
    expect(w.birthdates).toEqual([{ id: tid, name: expect.any(String), detail: "1 player missing" }]);

    // Filled in on the roster: the warning clears.
    const noah = roster.find((p) => p.first === "Noah")!;
    expect(await setOrgPlayerBirthdate(deps(), jo, org, tid, noah.id, "")).toMatchObject({ ok: false });
    expect(await setOrgPlayerBirthdate(deps(), jo, org, tid, noah.id, "2015-12-01")).toEqual({ ok: true });
    expect((await orgTeamWarnings(db.pool, org, now)).birthdates).toEqual([]);

    // Columns chosen in the form, in any order (Full name split; checked on the server).
    const lined = "Zoe Hart II     3/20/2017    4   24\nEli Park    9/1/2017   4   5";
    const layout = { columns: ["name", "birthdate", "grade", "jersey"], header: false };
    expect(await importOrgPlayers(deps(), jo, org, tid, lined, layout)).toMatchObject({ ok: true, added: ["Zoe Hart II", "Eli Park"] });
    expect((await listOrgRoster(deps(), jo, org, tid))!.players.find((p) => p.first === "Zoe")).toMatchObject({ last: "Hart II", birthdate: "2017-03-20" });
    expect(await importOrgPlayers(deps(), jo, org, tid, lined, { columns: ["birthdate", "grade"], header: false })).toMatchObject({ ok: false });
    expect(await importOrgPlayers(deps(), jo, org, tid, lined, { columns: ["name", "=HYPERLINK()"], header: false })).toMatchObject({ ok: false });

    // Fixed one by one in the Preview: rows sent back are checked again (Fix until right), then the new ones added.
    const fixing = [
      { line: 1, first: "Ivy", last: "Cole", grade: "", jersey: "30", birthdate: "4/4/2016" },
      { line: 2, first: "Zoe", last: "Hart II", grade: "4", jersey: "", birthdate: "3/20/2017" },
    ];
    expect(await previewPlayerRows(deps(), jo, org, tid, fixing)).toMatchObject({
      ok: true,
      rows: [{ status: "error", errors: ["Grade: K to 12"] }, { status: "exists" }],
    });
    fixing[0].grade = "4";
    expect(await previewPlayerRows(deps(), jo, org, tid, fixing)).toMatchObject({ ok: true, rows: [{ status: "new" }, { status: "exists" }] });
    expect(await importPlayerRows(deps(), jo, org, tid, fixing)).toMatchObject({ ok: true, added: ["Ivy Cole"] });
    expect(await importPlayerRows(deps(), jo, org, tid, "nope")).toMatchObject({ ok: false });
  }, 120_000);
  it("Edit team names: many Alternate names at once (all or none); blank goes back to the organization's name", async () => {
    const make = async (g: string) => ((await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: [g], level: "COMP" })) as { id: string }).id;
    const [a, b] = [await make("4"), await make("5")];
    expect(await setOrgTeamAltNames(deps(), jo, org, [{ id: a, alt: "Bolts" }, { id: b, alt: "=HYPERLINK()" }])).toMatchObject({ ok: false });
    const names = async () => (await db.pool.query("select id::text, name from org_teams order by id")).rows.map((r) => r.name);
    expect(await names()).toEqual(["4B East Ridge TBD", "5B East Ridge TBD"]); // nothing saved
    expect(await setOrgTeamAltNames(deps(), jo, org, [{ id: a, alt: "Bolts" }, { id: b, alt: "Lady Hawks" }])).toEqual({
      ok: true,
      names: { [a]: "4B Bolts TBD", [b]: "5B Lady Hawks TBD" },
    });
    expect(await setOrgTeamAltNames(deps(), jo, org, [{ id: b, alt: "" }])).toMatchObject({ ok: true, names: { [b]: "5B East Ridge TBD" } });
  }, 120_000);
});
