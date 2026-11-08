import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPin } from "./auth/crypto";
import { getSessionUser, type Deps } from "./auth/service";
import { registerTeam } from "./scenic-programs";
import { teamSignupComplete, teamSignupLookup, teamSignupStart, type TeamSignupInput } from "./team-signup";
import { createTestDb, testClock, testMailer } from "./testing/db";

describe("Register a team (outside coaches, no login yet)", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let mail: ReturnType<typeof testMailer>;
  let deps: Deps;
  let prog = "";
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());

  beforeEach(async () => {
    await db.reset();
    mail = testMailer();
    deps = { pool: db.pool, sendEmail: mail.sendEmail, now: testClock("2026-11-20T15:00:00Z").now };
    prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into game_days (day, created_by) values ('2026-12-05', 't'), ('2026-12-12', 't');
       insert into program_game_days (program_id, game_day_id, added_by, kind) select ${prog}, id, 't', 'game' from game_days;
       insert into scenic_program_options (program_id, kind, fee_cents) values (${prog}, 'all_season', 25000), (${prog}, 'single_1', 4000);
       insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 5, 5);
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, l from scenic_divisions, unnest(array['REC', 'COMP']) l;
       insert into scenic_grade_groups (division_id, grade, level) select id, 4, 'REC' from scenic_divisions;
       update scenic_divisions set grade_low = 4;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;`,
    );
  });

  const form = (more: Partial<TeamSignupInput> = {}): TeamSignupInput => ({
    programId: prog,
    choice: { allSeason: false, days: [{ date: "2026-12-05", kind: "single_1" }] },
    name: "5B Hixson Hoops",
    gender: "Boys",
    grade: "5",
    first: "Sam",
    last: "Lee",
    cell: "(423) 555-0101",
    email: "Sam@Example.com",
    pin1: "4321",
    pin2: "4321",
    staff: [
      { role: "AsstCoach", first: "Ann", last: "Cole", cell: "423-555-0102", email: "" },
      { role: "Manager", first: "", last: "", cell: "", email: "" }, // left empty: skipped
    ],
    ...more,
  });

  it("a new coach registers a team, verifies their email, gets a login and can register the team for the League", async () => {
    expect(await teamSignupLookup(deps, "4235550101")).toEqual({ step: "form", existing: false });
    // Checked on the server: Head Coach and team required; staff half-filled refused; PINs must match.
    expect(await teamSignupStart(deps, form({ email: "" }))).toMatchObject({ step: "error" });
    expect(await teamSignupStart(deps, form({ name: "=cmd" }))).toMatchObject({ step: "error" });
    expect(await teamSignupStart(deps, form({ programId: "999" }))).toMatchObject({
      step: "error",
      message: "Pick a program open for registration.",
    });
    expect(await teamSignupStart(deps, form({ choice: { allSeason: false, days: [] } }))).toMatchObject({
      step: "error",
      message: "Pick ALL Season or at least one date.",
    });
    expect(await teamSignupStart(deps, form({ gender: "Girls" }))).toMatchObject({
      step: "error",
      message: "Winter has no group for Girls in this grade.",
    });
    expect(
      await teamSignupStart(deps, form({ staff: [{ role: "TeamParent", first: "Jo", last: "", cell: "", email: "" }] })),
    ).toMatchObject({ step: "error", message: expect.stringMatching(/^Team Parent:/) });
    expect(await teamSignupStart(deps, form({ pin2: "1111" }))).toMatchObject({ step: "error" });
    expect(mail.sent).toHaveLength(0);

    expect(await teamSignupStart(deps, form())).toEqual({ step: "code", maskedEmail: expect.stringContaining("@example.com") });
    expect(mail.sent[0].to).toBe("sam@example.com");
    // Nothing saved before the code.
    expect((await db.pool.query("select 1 from users")).rowCount).toBe(0);
    expect(await teamSignupComplete(deps, "4235550101", "000000")).toMatchObject({ step: "error" });
    const done = await teamSignupComplete(deps, "4235550101", mail.lastCode());
    if (done.step !== "loggedIn") throw new Error(JSON.stringify(done));
    expect(done.programId).toBe(prog);

    const team = (
      await db.pool.query(
        "select name, gender, grade, level, owner_coach_id, coach_id, created_by from scenic_teams where id = $1",
        [done.teamId],
      )
    ).rows[0];
    expect(team).toEqual({
      name: "5B Hixson Hoops",
      gender: "Boys",
      grade: 5,
      level: "COMP", // no Level asked: COMP where the grade has a COMP group
      owner_coach_id: "5550101",
      coach_id: "5550101",
      created_by: "Sam Lee",
    });
    expect((await db.pool.query("select role, first_name, cell, email, added_by from scenic_team_staff")).rows).toEqual([
      { role: "AsstCoach", first_name: "Ann", cell: "4235550102", email: null, added_by: "Sam Lee" },
    ]);
    expect((await db.pool.query("select email, verified_email from users where coach_id = '5550101'")).rows[0]).toEqual({
      email: "sam@example.com",
      verified_email: "sam@example.com",
    });

    // Registered for the date picked, by the Head Coach; logged in, and can add to it.
    expect(
      (
        await db.pool.query(
          `select r.all_season, r.registered_by, array(select d.kind from scenic_registration_days d where d.team_id = r.team_id) as days
             from scenic_registrations r where r.team_id = $1`,
          [done.teamId],
        )
      ).rows,
    ).toEqual([{ all_season: false, registered_by: "Sam Lee", days: ["single_1"] }]);
    const me = await getSessionUser(deps, done.token);
    expect(me?.coachId).toBe("5550101");
    expect(
      await registerTeam(deps, me!, prog, done.teamId, { allSeason: false, days: [{ date: "2026-12-12", kind: "single_1" }] }),
    ).toMatchObject({ ok: true });

    // Team names are unique in Scenic City, any capitals.
    expect(await teamSignupStart(deps, form({ name: "5b hixson HOOPS", cell: "4235550199", email: "x@example.com" }))).toEqual({
      step: "error",
      message: "There's already a team named 5b hixson HOOPS. Pick another name.",
    });
  }, 60_000);

  it("a cell that already has a login enters its PIN (no new PIN); closed registration refuses", async () => {
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, active, pin_hash, cell) values ('5550101', 'Sam', 'Lee', true, $1, '4235550101')",
      [await hashPin("2468")],
    );
    expect(await teamSignupLookup(deps, "4235550101")).toEqual({ step: "form", existing: true });
    expect(await teamSignupStart(deps, form({ pin: "1111" }))).toMatchObject({
      step: "error",
      message: expect.stringMatching(/^Wrong PIN/),
    });
    expect(await teamSignupStart(deps, form({ pin: "2468" }))).toMatchObject({ step: "code" });
    // 4th grade has only REC: the team is REC.
    expect(await teamSignupStart(deps, form({ pin: "2468", grade: "4", name: "4B Lee" }))).toMatchObject({ step: "code" });
    const done = await teamSignupComplete(deps, "4235550101", mail.lastCode());
    expect(done).toMatchObject({ step: "loggedIn" });
    expect((await db.pool.query("select level from scenic_teams where name = '4B Lee'")).rows).toEqual([{ level: "REC" }]);
    expect((await db.pool.query("select verified_email from users where coach_id = '5550101'")).rows[0].verified_email).toBe(
      "sam@example.com",
    );

    await db.pool.query("update scenic_programs set reg_closes = '2026-11-01'");
    expect(await teamSignupLookup(deps, "4235550111")).toEqual({
      step: "error",
      message: "Team registration isn't open right now.",
    });
  }, 60_000);
});
