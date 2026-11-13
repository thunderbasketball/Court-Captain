import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashPin } from "./auth/crypto";
import { getSessionUser, type Deps } from "./auth/service";

import {
  teamSignupComplete,
  teamSignupForgot,
  teamSignupGo,
  teamSignupLookup,
  teamSignupPin,
  teamSignupReset,
  teamSignupStart,
  type TeamSignupInput,
} from "./team-signup";
import { makeSoloAccount } from "./court-solo";
import { withTx } from "./sql";
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
    // Organizations outlive a reset (CourtSolo accounts made here): clear them.
    await db.pool.query("delete from org_features where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
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
        "select name, gender, grade, level, owner_coach_id, coach_id, created_by, org_team_id is not null as in_account from scenic_teams where id = $1",
        [done.teamId],
      )
    ).rows[0];
    expect(team).toEqual({
      name: "5B Hixson Hoops",
      gender: "Boys",
      grade: 5,
      level: "COMP", // no Level asked: COMP where the grade has a COMP group
      owner_coach_id: null, // moved into its CourtSolo account
      coach_id: "5550101",
      created_by: "Sam Lee",
      in_account: true,
    });
    // Its own CourtSolo account, named for the team, owned by its Head Coach.
    expect(done.slug).toBe("5b-hixson-hoops");
    expect((await db.pool.query("select name, kind from organizations where slug = $1", [done.slug])).rows[0]).toEqual({
      name: "5B Hixson Hoops",
      kind: "Team",
    });
    expect(
      (await db.pool.query("select role from org_roles where coach_id = '5550101' and org = $1 order by role", [done.slug])).rows,
    ).toEqual([{ role: "Admin" }, { role: "Coach" }, { role: "Director" }, { role: "Owner" }]);
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

    // Team names are unique in Scenic City, any capitals.
    expect(await teamSignupStart(deps, form({ name: "5b hixson HOOPS", cell: "4235550199", email: "x@example.com" }))).toEqual({
      step: "error",
      message: "There's already a team named 5b hixson HOOPS. Pick another name.",
    });
  }, 60_000);

  it("a cell that already has a login enters its PIN (no new PIN); closed registration refuses", async () => {
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, active, pin_hash, cell, email) values ('5550101', 'Samuel', 'Lee', true, $1, '4235550101', 'sam@old.com')",
      [await hashPin("2468")],
    );
    // A cell with a login: its PIN first, then the Head Coach's information fills in from the login.
    expect(await teamSignupLookup(deps, "4235550101")).toEqual({ step: "pin" });
    expect(await teamSignupPin(deps, "4235550101", "1111")).toMatchObject({
      step: "error",
      message: expect.stringMatching(/^Wrong PIN/),
    });
    expect(await teamSignupPin(deps, "4235550101", "2468")).toEqual({
      step: "form",
      existing: true,
      coach: { first: "Samuel", last: "Lee", email: "sam@old.com" },
      accounts: { solo: [], orgs: [] },
    });
    expect(await teamSignupStart(deps, form({ pin: "1111" }))).toMatchObject({
      step: "error",
      message: expect.stringMatching(/^Wrong PIN/),
    });
    expect(await teamSignupStart(deps, form({ pin: "2468" }))).toMatchObject({ step: "code" });
    // 4th grade has only REC: the team is REC.
    expect(await teamSignupStart(deps, form({ pin: "2468", grade: "4", name: "4B Lee" }))).toMatchObject({ step: "code" });
    const done = await teamSignupComplete(deps, "4235550101", mail.lastCode());
    expect(done).toMatchObject({ step: "loggedIn" });
    expect((await db.pool.query("select level, created_by from scenic_teams where name = '4B Lee'")).rows).toEqual([
      { level: "REC", created_by: "Samuel Lee" }, // the login's own name, whatever was typed
    ]);
    expect((await db.pool.query("select verified_email from users where coach_id = '5550101'")).rows[0].verified_email).toBe(
      "sam@example.com",
    );

    await db.pool.query("update scenic_programs set reg_closes = '2026-11-01'");
    expect(await teamSignupLookup(deps, "4235550111")).toEqual({
      step: "error",
      message: "Team registration isn't open right now.",
    });
  }, 60_000);

  it("Forgot PIN: a code to the login's confirmed email (masked), then a new PIN opens the form", async () => {
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, active, pin_hash, cell, email, verified_email)
       values ('5550101', 'Earl', 'Epps', true, $1, '4235550101', 'earl.epps@gmail.com', 'earl.epps@gmail.com'),
              ('5550102', 'No', 'Email', true, $1, '4235550102', null, null)`,
      [await hashPin("2468")],
    );
    expect(await teamSignupForgot(deps, "4235550102")).toMatchObject({ step: "error" }); // no confirmed email
    expect(await teamSignupForgot(deps, "4235550101")).toEqual({ step: "resetCode", maskedEmail: "e*******s@gmail.com" });
    expect(mail.sent.at(-1)?.to).toBe("earl.epps@gmail.com");
    expect(await teamSignupReset(deps, "4235550101", "000000", "1357", "1357")).toMatchObject({ step: "error" });
    expect(await teamSignupReset(deps, "4235550101", mail.lastCode(), "1357", "1358")).toMatchObject({ step: "error" });
    expect(await teamSignupReset(deps, "4235550101", mail.lastCode(), "1357", "1357")).toEqual({
      step: "form",
      existing: true,
      coach: { first: "Earl", last: "Epps", email: "earl.epps@gmail.com" },
      accounts: { solo: [], orgs: [] },
    });
    // The new PIN works; the old one doesn't.
    expect(await teamSignupPin(deps, "4235550101", "2468")).toMatchObject({ step: "error" });
    expect(await teamSignupPin(deps, "4235550101", "1357")).toMatchObject({ step: "form", existing: true });
  }, 60_000);

  it("a returning CourtSolo coach is asked first: register their team, archive it for a new one, or switch to CourtOrg", async () => {
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, active, pin_hash, cell, email, verified_email)
       values ('5550101', 'Sam', 'Lee', true, $1, '4235550101', 'sam@example.com', 'sam@example.com')`,
      [await hashPin("2468")],
    );
    const old = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('Magic', 'Boys', 5, 5, 'COMP', '5550101', '5550101', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    const slug = await withTx(db.pool, (q) => makeSoloAccount(q, old, "t", new Date()));
    expect(await teamSignupPin(deps, "4235550101", "2468")).toMatchObject({
      step: "form",
      accounts: { solo: [{ slug: "magic", teamName: "Magic", busyIn: null, inPrograms: [] }], orgs: [] },
    });
    // One active team: a new one must replace Magic, never a second account.
    expect(await teamSignupStart(deps, form({ pin: "2468" }))).toEqual({
      step: "error",
      message: "You already have Magic: register it, or archive it to make a new team.",
    });
    expect(await teamSignupStart(deps, form({ pin: "2468", replace: slug }))).toMatchObject({ step: "code" });
    const done = await teamSignupComplete(deps, "4235550101", mail.lastCode());
    expect(done).toMatchObject({ step: "loggedIn", slug: "magic" });
    expect((await db.pool.query("select name, archived_at is not null as archived from org_teams order by id")).rows).toEqual([
      { name: "Magic", archived: true },
      { name: "5B Hixson Hoops", archived: false },
    ]);
    expect((await db.pool.query("select name from organizations where slug = 'magic'")).rows[0].name).toBe("5B Hixson Hoops");

    // Or: straight to their team's Register tab (PIN checked again), or switch to CourtOrg.
    expect(await teamSignupGo(deps, "4235550101", "1111", { to: "register", slug })).toMatchObject({ step: "error" });
    expect(await teamSignupGo(deps, "4235550101", "2468", { to: "register", slug })).toMatchObject({
      step: "loggedIn",
      next: "/org/magic?open=teams&view=register#teams",
    });
    expect(await teamSignupGo(deps, "4235550101", "2468", { to: "org", slug })).toMatchObject({ step: "error" }); // not an organization
    expect(
      await teamSignupGo(deps, "4235550101", "2468", { to: "switch", slug, name: "Hixson Hoops", short: "Hixson" }),
    ).toMatchObject({ step: "loggedIn", slug: "hixson-hoops", next: "/org/hixson-hoops?open=teams#teams" });
  }, 60_000);
});
