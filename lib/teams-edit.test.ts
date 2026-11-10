import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { createTestDb, grant } from "./testing/db";
import { HEADER, row } from "./teamsnap/fixtures";
import { importRegistrations } from "./teamsnap/import";
import { parseRegistrations } from "./teamsnap/parse";
import { addStaff, createTeam, getTeam, removeStaff, rosterParentOptions, updateTeam } from "./teams";

const director: SessionUser = {
  coachId: "9913694",
  firstName: "Earl",
  lastName: "Epps",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: true,
};
const asUser = (coachId: string, first: string, last: string): SessionUser => ({
  ...director,
  coachId,
  firstName: first,
  lastName: last,
  isDirector: false,
  isCoach: true,
});
const head = asUser("5550001", "Hal", "Head");
const other = asUser("5550002", "Ollie", "Other");

describe("editing teams and staff", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  const now = new Date("2026-10-28T12:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  let teamId: string;

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('9913694', 'Earl', 'Epps', '4239913694'),
         ('5550001', 'Hal', 'Head', '4235550001'),
         ('5550002', 'Ollie', 'Other', '4235550002')`,
    );
    await grant(db.pool, "9913694 thunder Director", "5550001 thunder Coach");
    const csv = parseRegistrations([HEADER, row({ rid: "1", coach: "Assistant Coach" })].join("\n"), { schoolYear: 2026 });
    await importRegistrations(db.pool, csv, "Earl Epps", now);
    const t = await createTeam(deps(), director, { gender: "Girls", grades: ["4"], level: "REC", headCoach: "user:5550001" });
    if (!t.ok) throw new Error(t.message);
    teamId = t.id;
  });

  const staff = async () => (await getTeam(deps(), director, teamId))!.staff.map((s) => `${s.role}:${s.lastName}`);

  it("the Director edits grades, level and locations; the name follows", async () => {
    const r = await updateTeam(deps(), director, teamId, {
      gender: "Girls",
      grades: ["4", "5"],
      level: "COMP",
      practiceLocations: "Action Church, East Ridge MS",
    });
    expect(r).toEqual({ ok: true, name: "5G Head" });
    expect(await getTeam(deps(), director, teamId)).toMatchObject({
      name: "5G Head",
      grades: ["4", "5"],
      level: "COMP",
      practiceLocations: ["Action Church", "East Ridge MS"],
    });
  });

  it("an edit that gives another team's name numbers both", async () => {
    await createTeam(deps(), director, { gender: "Girls", grades: ["5"], level: "REC", headCoach: "user:5550001" });
    const r = await updateTeam(deps(), director, teamId, {
      gender: "Girls",
      grades: ["5"],
      level: "COMP",
      practiceLocations: "",
    });
    expect(r).toMatchObject({ ok: true, name: "5G Head 2" });
    const names = await db.pool.query<{ name: string }>("select name from teams order by name");
    expect(names.rows.map((x) => x.name)).toEqual(["5G Head 1", "5G Head 2"]);
    // Back to 4th grade: the 5th grade team left alone drops its number.
    await updateTeam(deps(), director, teamId, { gender: "Girls", grades: ["4"], level: "COMP", practiceLocations: "" });
    const after = await db.pool.query<{ name: string }>("select name from teams order by name");
    expect(after.rows.map((x) => x.name)).toEqual(["4G Head", "5G Head"]);
  });

  it("bad gym names are refused", async () => {
    const r = await updateTeam(deps(), director, teamId, {
      gender: "Girls",
      grades: ["4"],
      level: "REC",
      practiceLocations: "=cmd()",
    });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/valid gym name/) });
  });

  it("adds staff from users, volunteers, and a new person (who gets a login)", async () => {
    expect(await addStaff(deps(), director, teamId, { role: "Manager", person: "user:5550002" })).toMatchObject({
      ok: true,
      newLogin: false,
    });
    expect(await addStaff(deps(), director, teamId, { role: "AsstCoach", person: "volunteer:1" })).toMatchObject({
      ok: true,
      who: "Pat Test",
      newLogin: true,
    });
    const r = await addStaff(deps(), director, teamId, {
      role: "TeamParent",
      person: { first: " Tia ", last: "Parent", cell: "(423) 555-7777", email: "Tia@Example.com" },
    });
    expect(r).toMatchObject({ ok: true, who: "Tia Parent", newLogin: true });
    expect(await staff()).toEqual(["HeadCoach:Head", "AsstCoach:Test", "Manager:Other", "TeamParent:Parent"]);
    const tia = await db.pool.query(
      `select coach_id, cell, email, has_role(coach_id, 'thunder', 'Coach') as thunder_coach, pin_hash from users where cell = '4235557777'`,
    );
    expect(tia.rows[0]).toEqual({
      coach_id: "5557777",
      cell: "4235557777",
      email: "tia@example.com",
      thunder_coach: false,
      pin_hash: null,
    });
    // The assistant coach gets the Coach flag.
    expect(
      (await db.pool.query("select has_role(coach_id, 'thunder', 'Coach') as thunder_coach from users where cell = '4235550000'"))
        .rows[0].thunder_coach,
    ).toBe(true);
    // Who added each one is recorded.
    expect((await getTeam(deps(), director, teamId))!.staff.every((s) => s.addedBy === "Earl Epps")).toBe(true);
  });

  it("a new person whose cell is already a user is matched, not duplicated", async () => {
    const r = await addStaff(deps(), director, teamId, {
      role: "Manager",
      person: { first: "Ollie", last: "Other", cell: "4235550002", email: "" },
    });
    expect(r).toMatchObject({ ok: true, who: "Ollie Other", newLogin: false });
    expect((await db.pool.query("select count(*)::int n from users")).rows[0].n).toBe(3);
  });

  it("checks new-person details", async () => {
    const add = (person: object) => addStaff(deps(), director, teamId, { role: "TeamParent", person });
    expect(await add({ first: "", last: "X", cell: "4235557777" })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/first and last name/),
    });
    expect(await add({ first: "=1+1", last: "X", cell: "4235557777" })).toMatchObject({ ok: false });
    expect(await add({ first: "A", last: "B", cell: "555" })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/10-digit/),
    });
    expect(await add({ first: "A", last: "B", cell: "4235557777", email: "nope" })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/email/),
    });
    expect(await add({ first: "A", last: "B", cell: "6155550002" })).toMatchObject({
      ok: false,
      message: expect.stringMatching(/same 7 digits/),
    });
    expect(await staff()).toEqual(["HeadCoach:Head"]);
  });

  it("one person per role: a filled role is refused until it's removed", async () => {
    await addStaff(deps(), director, teamId, { role: "Manager", person: "user:5550002" });
    const again = await addStaff(deps(), director, teamId, {
      role: "Manager",
      person: { first: "New", last: "Person", cell: "4235558888", email: "" },
    });
    expect(again).toEqual({ ok: false, message: "This team already has a Manager (Ollie Other). Remove them first." });
    expect((await db.pool.query("select count(*)::int n from users where cell = '4235558888'")).rows[0].n).toBe(0); // nothing created
    await removeStaff(deps(), director, teamId, { coachId: "5550002", role: "Manager" });
    expect(
      await addStaff(deps(), director, teamId, {
        role: "Manager",
        person: { first: "New", last: "Person", cell: "4235558888", email: "" },
      }),
    ).toMatchObject({ ok: true });
    expect(await staff()).toEqual(["HeadCoach:Head", "Manager:Person"]);
  });

  it("a new head coach replaces the old one and renames the team", async () => {
    const r = await addStaff(deps(), director, teamId, { role: "HeadCoach", person: "user:5550002" });
    expect(r).toMatchObject({ ok: true, name: "4G Other" });
    expect(await staff()).toEqual(["HeadCoach:Other"]);
  });

  it("removes staff", async () => {
    await addStaff(deps(), director, teamId, { role: "Manager", person: "user:5550002" });
    expect(await removeStaff(deps(), director, teamId, { coachId: "5550002", role: "Manager" })).toEqual({ ok: true });
    expect(await staff()).toEqual(["HeadCoach:Head"]);
  });

  it("the head coach manages other staff, but not the head coach spot or team details", async () => {
    expect(await getTeam(deps(), head, teamId)).toMatchObject({ canEditStaff: true, canEditTeam: false });
    expect(await addStaff(deps(), head, teamId, { role: "AsstCoach", person: "user:5550002" })).toMatchObject({ ok: true });
    expect(await removeStaff(deps(), head, teamId, { coachId: "5550002", role: "AsstCoach" })).toEqual({ ok: true });
    expect(await addStaff(deps(), head, teamId, { role: "HeadCoach", person: "user:5550002" })).toMatchObject({
      ok: false,
      message: /Director/,
    });
    expect(await removeStaff(deps(), head, teamId, { coachId: "5550001", role: "HeadCoach" })).toMatchObject({ ok: false });
    expect(
      await updateTeam(deps(), head, teamId, { gender: "Girls", grades: ["4"], level: "REC", practiceLocations: "" }),
    ).toMatchObject({ ok: false });
  });

  it("the head coach adds a parent of a player on the team's roster, not anyone else's", async () => {
    await db.pool.query(
      `update registrations set parent2_first = 'Pat', parent2_last = 'Parent', parent2_cell = '4235550099', parent2_email = 'pat@x.com'
        where registrant_id = '1'`,
    );
    expect(await rosterParentOptions(deps(), teamId)).toEqual([]); // nobody rostered yet
    expect(await addStaff(deps(), head, teamId, { role: "TeamParent", person: "parent:1:2" })).toMatchObject({ ok: false });
    await db.pool.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       values ($1, '1', 'Kid', 'K', 'Girls', '4', 4, 'x', now())`,
      [teamId],
    );
    const opts = await rosterParentOptions(deps(), teamId);
    expect(opts.find((o) => o.value === "parent:1:2")).toMatchObject({ firstName: "Pat", lastName: "Parent", detail: "Parent of Kid" });
    expect(await addStaff(deps(), head, teamId, { role: "TeamParent", person: "parent:1:2" })).toMatchObject({ ok: true });
    expect(await staff()).toContain("TeamParent:Parent");
    expect(await addStaff(deps(), head, teamId, { role: "Manager", person: "parent:1:3" })).toMatchObject({ ok: false });
  });

  it("other staff can view the team but not change it", async () => {
    await addStaff(deps(), director, teamId, { role: "TeamParent", person: "user:5550002" });
    expect(await getTeam(deps(), other, teamId)).toMatchObject({
      myRoles: ["TeamParent"],
      canEditStaff: false,
      canEditTeam: false,
    });
    expect(await addStaff(deps(), other, teamId, { role: "Manager", person: "user:5550002" })).toMatchObject({ ok: false });
  });

  it("anyone else can't see or change the team", async () => {
    expect(await getTeam(deps(), other, teamId)).toBeNull();
    expect(await addStaff(deps(), other, teamId, { role: "TeamParent", person: "user:5550002" })).toMatchObject({
      ok: false,
      message: /Director or this team's head coach/,
    });
    expect(await removeStaff(deps(), other, teamId, { coachId: "5550001", role: "HeadCoach" })).toMatchObject({ ok: false });
    expect(await staff()).toEqual(["HeadCoach:Head"]);
  });
});
