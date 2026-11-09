import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { createTestDb, grant } from "./testing/db";
import { HEADER, row } from "./teamsnap/fixtures";
import { importRegistrations } from "./teamsnap/import";
import { parseRegistrations } from "./teamsnap/parse";
import { createTeam, deleteTeam, personOptions, listTeams, teamName } from "./teams";

const director: SessionUser = {
  coachId: "9913694",
  firstName: "Earl",
  lastName: "Epps",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: true,
};
const coach: SessionUser = {
  ...director,
  coachId: "5550001",
  firstName: "Cal",
  lastName: "Coach",
  isDirector: false,
  isCoach: true,
};

describe("teamName", () => {
  it("uses the top grade, gender letter and head coach's last name", () => {
    expect(teamName("Girls", ["4"], "Epps")).toBe("4G Epps");
    expect(teamName("Girls", ["7", "8"], "Black")).toBe("8G Black");
    expect(teamName("Boys", ["K"], " Harper ")).toBe("KB Harper");
    expect(teamName("Boys", ["K", "10", "9"], "Lee")).toBe("10B Lee");
  });
});

describe("teams", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });

  const now = new Date("2026-10-28T12:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('9913694', 'Earl', 'Epps', '4239913694'),
         ('5550001', 'Cal', 'Coach', '4235550001')`,
    );
    await grant(db.pool, "9913694 thunder Director");
    // Volunteer parents: Pat Test (Head Coach, cell 4235550000) and one with a bad cell.
    const csv = parseRegistrations(
      [
        HEADER,
        row({ rid: "1", coach: "Head Coach" }),
        row({ rid: "2", first: "Zed", coach: "Assistant Coach", cell: "423555" }),
        row({ rid: "3" }),
      ].join("\n"),
      { schoolYear: 2026 },
    );
    await importRegistrations(db.pool, csv, "Earl Epps", now);
  });

  it("creates a team with an existing user as head coach, and records who made it", async () => {
    const r = await createTeam(deps(), director, { gender: "Girls", grades: ["4"], level: "REC", headCoach: "user:9913694" });
    expect(r).toMatchObject({ ok: true, name: "4G Epps" });
    const teams = await listTeams(deps(), director);
    expect(teams).toEqual([
      expect.objectContaining({
        name: "4G Epps",
        gender: "Girls",
        grades: ["4"],
        level: "REC",
        createdBy: "Earl Epps",
        headCoach: { first: "Earl", last: "Epps", cell: "4239913694" },
        staff: [{ coachId: "9913694", role: "HeadCoach", first: "Earl", last: "Epps", cell: "4239913694", email: null }],
      }),
    ]);
  });

  it("picking a volunteer creates their login with the Coach role and starter PIN", async () => {
    const opts = await personOptions(deps(), director);
    expect(opts.volunteers.map((v) => v.value)).toEqual(["volunteer:1"]); // bad cell left out
    const r = await createTeam(deps(), director, { gender: "Boys", grades: ["1", "2"], level: "COMP", headCoach: "volunteer:1" });
    expect(r).toMatchObject({ ok: true, name: "2B Test" });
    const u = await db.pool.query(
      "select coach_id, first_name, cell, email, pin_hash, has_role(coach_id, 'thunder', 'Coach') as thunder_coach from users where cell = '4235550000'",
    );
    expect(u.rows).toEqual([
      {
        coach_id: "5550000",
        first_name: "Pat",
        cell: "4235550000",
        email: "pat@example.com",
        pin_hash: null,
        thunder_coach: true,
      },
    ]);
    // Now a user, so no longer offered as a volunteer.
    expect((await personOptions(deps(), director)).volunteers).toEqual([]);
    // Users: only Thunder's active people (a Thunder role or a team spot); a login from another organization isn't offered.
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5559999', 'Out', 'Side', '4235559999')",
    );
    await db.pool.query("select set_role('5559999', 'scenic-city', 'Coach', true, 'test')");
    const users = (await personOptions(deps(), director)).users.map((u) => u.value);
    expect(users).toContain("user:5550000");
    expect(users).not.toContain("user:5559999");
  });

  it("gives an existing user the Coach role when they become a head coach", async () => {
    await grant(db.pool, "5550001 thunder Request");
    await createTeam(deps(), director, { gender: "Boys", grades: ["3"], level: "REC", headCoach: "user:5550001" });
    const u = await db.pool
      .query(`select has_role(coach_id, 'thunder', 'Coach') as thunder_coach, has_role(coach_id, 'thunder', 'Request') as thunder_request
       from users where coach_id = '5550001'`);
    expect(u.rows[0]).toEqual({ thunder_coach: true, thunder_request: false });
  });

  it("the same name numbers both teams (and a lone one drops its number when the other goes)", async () => {
    await createTeam(deps(), director, { gender: "Girls", grades: ["4"], level: "COMP", headCoach: "user:9913694" });
    const r = await createTeam(deps(), director, { gender: "Girls", grades: ["4"], level: "REC", headCoach: "user:9913694" });
    expect(r).toMatchObject({ ok: true, name: "4G Epps 2" });
    expect((await listTeams(deps(), director))!.map((t) => t.name).sort()).toEqual(["4G Epps 1", "4G Epps 2"]);
    // TBD teams the same way.
    await createTeam(deps(), director, { gender: "Boys", grades: ["3"], level: "REC", headCoach: "none" });
    expect(await createTeam(deps(), director, { gender: "Boys", grades: ["3"], level: "COMP", headCoach: "none" })).toMatchObject(
      { name: "3B TBD 2" },
    );
    expect(await deleteTeam(deps(), director, (r as { id: string }).id)).toEqual({ ok: true });
    expect((await listTeams(deps(), director))!.map((t) => t.name).sort()).toEqual(["3B TBD 1", "3B TBD 2", "4G Epps"]);
  });

  it("refuses a volunteer whose cell matches another user's last 7 digits", async () => {
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550000', 'Other', 'Person', '6155550000')",
    );
    const r = await createTeam(deps(), director, { gender: "Boys", grades: ["1"], level: "REC", headCoach: "volunteer:1" });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/same 7 digits as Other Person/) });
    expect(await listTeams(deps(), director)).toEqual([]);
  });

  it("refuses a volunteer without a 10-digit cell", async () => {
    const r = await createTeam(deps(), director, { gender: "Boys", grades: ["1"], level: "REC", headCoach: "volunteer:2" });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/10-digit cell/) });
  });

  it("validates every field on the server", async () => {
    const base = { gender: "Girls", grades: ["4"], level: "REC", headCoach: "user:9913694" };
    expect(await createTeam(deps(), director, { ...base, gender: "Coed" })).toMatchObject({
      ok: false,
      message: "Pick Boys or Girls.",
    });
    expect(await createTeam(deps(), director, { ...base, grades: [] })).toMatchObject({
      ok: false,
      message: "Pick at least one grade.",
    });
    expect(await createTeam(deps(), director, { ...base, grades: ["13"] })).toMatchObject({ ok: false });
    expect(await createTeam(deps(), director, { ...base, level: "PRO" })).toMatchObject({
      ok: false,
      message: "Pick REC or COMP.",
    });
    expect(await createTeam(deps(), director, { ...base, headCoach: "user:1; drop table teams" })).toMatchObject({
      ok: false,
      message: "Pick a person.",
    });
    expect(await createTeam(deps(), director, { ...base, headCoach: "user:1234567" })).toMatchObject({
      ok: false,
      message: "That person isn't an active user.",
    });
  });

  it("only the Director can create or list teams", async () => {
    const r = await createTeam(deps(), coach, { gender: "Girls", grades: ["4"], level: "REC", headCoach: "user:9913694" });
    expect(r).toEqual({ ok: false, message: "Only a Director of Teams can create teams." });
    await expect(listTeams(deps(), coach)).rejects.toThrow("Director only");
    await expect(personOptions(deps(), coach)).rejects.toThrow("Director only");
  });

  it("lists Comp before Rec, then Boys before Girls, youngest grade first", async () => {
    const mk = (gender: string, grades: string[], level: string) =>
      createTeam(deps(), director, { gender, grades, level, headCoach: "user:9913694" });
    await mk("Girls", ["5"], "REC");
    await mk("Boys", ["10"], "COMP");
    await mk("Boys", ["2"], "COMP");
    await mk("Girls", ["K"], "COMP");
    await mk("Boys", ["4"], "REC");
    expect((await listTeams(deps(), director)).map((t) => t.name)).toEqual([
      "2B Epps",
      "10B Epps",
      "KG Epps",
      "4B Epps",
      "5G Epps",
    ]);
  });

  it("a Director of Teams deletes a team: its staff go and its booked practice times open up; others can't", async () => {
    const r = (await createTeam(deps(), director, {
      gender: "Girls",
      grades: ["4"],
      level: "REC",
      headCoach: "user:9913694",
    })) as { id: string };
    const g = await db.pool.query<{ id: string }>("insert into gyms (name) values ('Gym') returning id::text");
    const c = await db.pool.query<{ id: string }>("insert into courts (gym_id, name) values ($1, 'Main') returning id::text", [
      g.rows[0].id,
    ]);
    await db.pool.query(
      "insert into slots (court_id, starts_at, team_id, booked_by, booked_at, created_by) values ($1, '2026-11-10T23:00:00Z', $2, 'Earl Epps', now(), 'x')",
      [c.rows[0].id, r.id],
    );
    expect(await deleteTeam(deps(), coach, r.id)).toEqual({ ok: false, message: "Only a Director of Teams can delete a team." });
    expect(await deleteTeam(deps(), { ...director, thunderAreas: ["facilities"] }, r.id)).toMatchObject({ ok: false });

    expect(await deleteTeam(deps(), director, r.id)).toEqual({ ok: true });
    expect((await db.pool.query("select count(*)::int n from team_staff")).rows[0].n).toBe(0);
    expect((await db.pool.query("select team_id, booked_by, booked_at from slots")).rows).toEqual([
      { team_id: null, booked_by: null, booked_at: null },
    ]);
    expect(await deleteTeam(deps(), director, r.id)).toEqual({ ok: false, message: "That team no longer exists." });
  });
});
