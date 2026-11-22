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
import type { StripeApi } from "./stripe/connect";
import { cardFee, confirmPayment } from "./stripe/registration";

describe("Register (an organization's teams, no login yet)", () => {
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

  const choice = { allSeason: false, days: [{ date: "2026-12-05", kind: "single_1" }] };
  const team = (more: Record<string, unknown> = {}) => ({
    gender: "Boys",
    grade: "5",
    head: "me",
    staff: [
      { role: "AsstCoach", first: "Ann", last: "Cole", cell: "423-555-0102", email: "" },
      { role: "Manager", first: "", last: "", cell: "", email: "" }, // left empty: skipped
    ],
    choice,
    ...more,
  });
  const form = (more: Partial<TeamSignupInput> = {}): TeamSignupInput => ({
    programId: prog,
    orgName: "Hixson Hoops",
    first: "Sam",
    last: "Lee",
    cell: "(423) 555-0101",
    email: "Sam@Example.com",
    pin1: "4321",
    pin2: "4321",
    teams: [team()],
    ...more,
  });
  const second = { gender: "Boys", grade: "4", head: { first: "Pat", last: "Kim", cell: "423-555-0103", email: "pat@example.com" }, staff: [], choice: { allSeason: true, days: [] } };

  it("a new person registers their organization's teams, verifies their email, and is its Owner, logged in", async () => {
    expect(await teamSignupLookup(deps, "4235550101")).toEqual({ step: "form", existing: false });
    // Checked on the server: organization, person and teams required; staff half-filled refused; PINs must match.
    expect(await teamSignupStart(deps, form({ orgName: "" }))).toMatchObject({ step: "error", message: expect.stringMatching(/organization's name/) });
    expect(await teamSignupStart(deps, form({ orgName: "=cmd" }))).toMatchObject({ step: "error" });
    expect(await teamSignupStart(deps, form({ email: "" }))).toMatchObject({ step: "error", message: "Enter your email." });
    expect(await teamSignupStart(deps, form({ teams: [] }))).toMatchObject({ step: "error", message: "Add a team." });
    expect(await teamSignupStart(deps, form({ programId: "999" }))).toMatchObject({
      step: "error",
      message: "Pick a program open for registration.",
    });
    expect(await teamSignupStart(deps, form({ teams: [team({ choice: { allSeason: false, days: [] } })] }))).toMatchObject({
      step: "error",
      message: "Pick ALL Season or at least one date.",
    });
    expect(await teamSignupStart(deps, form({ teams: [team(), team({ gender: "Girls" })] }))).toMatchObject({
      step: "error",
      message: "Team 2: Winter has no group for Girls in this grade.",
    });
    expect(await teamSignupStart(deps, form({ teams: [team(), { ...second, head: { ...second.head, email: "" } }] }))).toMatchObject({
      step: "error",
      message: "Team 2: Enter the Head Coach's email.",
    });
    expect(
      await teamSignupStart(deps, form({ teams: [team({ staff: [{ role: "TeamParent", first: "Jo", last: "", cell: "", email: "" }] })] })),
    ).toMatchObject({ step: "error", message: expect.stringMatching(/^Team Parent:/) });
    expect(await teamSignupStart(deps, form({ pin2: "1111" }))).toMatchObject({ step: "error" });
    expect(mail.sent).toHaveLength(0);

    expect(await teamSignupStart(deps, form({ teams: [team({ alt: "=HYPERLINK()" })] }))).toMatchObject({
      step: "error",
      message: expect.stringMatching(/^Alternate name:/),
    });
    expect(await teamSignupStart(deps, form({ teams: [team(), { ...second, alt: "Hoopers" }] }))).toEqual({
      step: "code",
      maskedEmail: expect.stringContaining("@example.com"),
    });
    expect(mail.sent[0].to).toBe("sam@example.com");
    // Nothing saved before the code.
    expect((await db.pool.query("select 1 from users")).rowCount).toBe(0);
    expect(await teamSignupComplete(deps, "4235550101", "000000")).toMatchObject({ step: "error" });
    const done = await teamSignupComplete(deps, "4235550101", mail.lastCode());
    if (done.step !== "loggedIn") throw new Error(JSON.stringify(done));
    expect(done.programId).toBe(prog);

    // The organization (CourtClub on), its Owner the person registering (also Coach: Head Coach of team 1).
    expect(done.slug).toBe("hixson-hoops");
    expect((await db.pool.query("select name, kind, abbr, created_by from organizations where slug = $1", [done.slug])).rows[0]).toEqual({
      name: "Hixson Hoops",
      kind: "Organization",
      abbr: "HH",
      created_by: "Sam Lee",
    });
    expect((await db.pool.query("select feature from org_features where org = $1", [done.slug])).rows).toEqual([{ feature: "court-club" }]);
    expect(
      (await db.pool.query("select role from org_roles where coach_id = '5550101' and org = $1 order by role", [done.slug])).rows,
    ).toEqual([{ role: "Admin" }, { role: "Coach" }, { role: "Director" }, { role: "Owner" }]);
    // Its teams, named by the rule, with their staff; the other Head Coach got a user (Coach there), no login yet.
    expect(
      (
        await db.pool.query(
          `select t.name, t.level, array(select c.role || ':' || c.coach_id from org_team_coaches c where c.team_id = t.id order by c.role) as staff
             from org_teams t where t.org = $1 order by t.id`,
          [done.slug],
        )
      ).rows,
    ).toEqual([
      // No name typed: grade and gender, the organization's name, the Head Coach's last name. COMP where the grade has a COMP group.
      { name: "5B Hixson Hoops Lee", level: "COMP", staff: ["AsstCoach:5550102", "HeadCoach:5550101"] },
      { name: "4B Hoopers Kim", level: "REC", staff: ["HeadCoach:5550103"] }, // its Alternate name in the organization's place; 4th grade has only REC
    ]);
    expect((await db.pool.query("select first_name, email, pin_hash is null as no_login from users where coach_id = '5550103'")).rows[0]).toEqual({
      first_name: "Pat",
      email: "pat@example.com",
      no_login: true,
    });
    expect((await db.pool.query("select role from org_roles where coach_id = '5550103' and org = $1", [done.slug])).rows).toEqual([{ role: "Coach" }]);
    expect((await db.pool.query("select email, verified_email from users where coach_id = '5550101'")).rows[0]).toEqual({
      email: "sam@example.com",
      verified_email: "sam@example.com",
    });

    // Each registered in the League as picked, by the person registering, under its League name.
    expect(
      (
        await db.pool.query(
          `select t.name, r.all_season, r.registered_by, array(select d.kind from scenic_registration_days d where d.team_id = r.team_id) as days
             from scenic_registrations r join scenic_teams t on t.id = r.team_id where r.program_id = $1 order by t.id`,
          [prog],
        )
      ).rows,
    ).toEqual([
      { name: "5B Hixson Hoops Lee", all_season: false, registered_by: "Sam Lee", days: ["single_1"] }, // COMP: just its name
      { name: "HH 4B Hoopers Kim", all_season: true, registered_by: "Sam Lee", days: [] }, // REC: the Abbreviation first
    ]);
    const me = await getSessionUser(deps, done.token);
    expect(me?.coachId).toBe("5550101");

    // Organization names are unique on CourtCaptain, any capitals.
    expect(await teamSignupStart(deps, form({ orgName: "hixson HOOPS", cell: "4235550199", email: "x@example.com" }))).toEqual({
      step: "error",
      message: "There's already an organization named hixson HOOPS on CourtCaptain.",
    });
  }, 60_000);

  it("a cell that already has a login enters its PIN (no new PIN); closed registration refuses", async () => {
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, active, pin_hash, cell, email) values ('5550101', 'Samuel', 'Lee', true, $1, '4235550101', 'sam@old.com')",
      [await hashPin("2468")],
    );
    // A cell with a login: its PIN first, then their information fills in from the login.
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
    const done = await teamSignupComplete(deps, "4235550101", mail.lastCode());
    expect(done).toMatchObject({ step: "loggedIn", slug: "hixson-hoops" });
    expect((await db.pool.query("select name, created_by from org_teams")).rows).toEqual([
      { name: "5B Hixson Hoops Lee", created_by: "Samuel Lee" }, // the login's own name, whatever was typed
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

  it("a returning CourtSolo coach is asked first: register their team, switch to CourtOrg, or register a new organization", async () => {
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
    // Straight to their team's Register tab (PIN checked again).
    expect(await teamSignupGo(deps, "4235550101", "1111", { to: "register", slug })).toMatchObject({ step: "error" });
    expect(await teamSignupGo(deps, "4235550101", "2468", { to: "register", slug })).toMatchObject({
      step: "loggedIn",
      next: "/org/magic?open=register#register",
    });
    expect(await teamSignupGo(deps, "4235550101", "2468", { to: "org", slug })).toMatchObject({ step: "error" }); // not an organization
    // Or a new organization alongside it (Magic stays as it is).
    expect(await teamSignupStart(deps, form({ pin: "2468", teams: [team({ staff: [] })] }))).toMatchObject({ step: "code" });
    expect(await teamSignupComplete(deps, "4235550101", mail.lastCode())).toMatchObject({ step: "loggedIn", slug: "hixson-hoops" });
    expect((await db.pool.query("select org, name from org_teams order by id")).rows).toEqual([
      { org: "magic", name: "Magic" },
      { org: "hixson-hoops", name: "5B Hixson Hoops Lee" },
    ]);
    // Or switch the CourtSolo account to CourtOrg.
    expect(
      await teamSignupGo(deps, "4235550101", "2468", { to: "switch", slug, name: "Lee Hoops", short: "Lee Hoops" }),
    ).toMatchObject({ step: "loggedIn", slug: "lee-hoops", next: "/org/lee-hoops?open=teams#teams" });
  }, 60_000);
  it("Scenic City takes cards: the teams are made, then registered only once Stripe says it's paid (one payment for all)", async () => {
    const checkouts: { account: string; lines: { name: string; cents: number }[]; cancelUrl: string; successUrl: string }[] = [];
    const paid = new Set<string>();
    const stripe: StripeApi = {
      live: false,
      createAccount: async () => "acct_x",
      isReady: async () => true,
      onboardingLink: async () => "https://connect.stripe.test",
      createCheckout: async (c) => {
        checkouts.push(c);
        return { id: `cs_test_${c.ref}`, url: `https://checkout.stripe.test/cs_test_${c.ref}` };
      },
      checkoutPaid: async ({ id }) => paid.has(id),
      refund: async () => "re_test_1",
    };
    await db.pool.query(
      "insert into org_stripe (org, livemode, account_id, connected_by, charges_enabled, fee_payer) values ('scenic-city', false, 'acct_league', 'Dee X', true, 'team')",
    );
    expect(await teamSignupStart(deps, form({ teams: [team(), second] }))).toMatchObject({ step: "code" });
    const done = await teamSignupComplete(deps, "4235550101", mail.lastCode(), { stripe, base: "https://app.test" });
    if (done.step !== "loggedIn") throw new Error(JSON.stringify(done));
    expect(done.pay).toMatch(/^https:\/\/checkout\.stripe\.test\/cs_test_\d+$/);
    // Logged in with the organization and both teams made, neither registered yet.
    expect((await db.pool.query("select count(*)::int n from org_teams where org = 'hixson-hoops'")).rows[0].n).toBe(2);
    expect((await db.pool.query("select count(*)::int n from scenic_registrations")).rows[0].n).toBe(0);
    // One Checkout on the League's account: a line per team (its price), then Card processing on the total.
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].account).toBe("acct_league");
    expect(checkouts[0].lines.slice(0, 2).map((l) => l.cents).sort()).toEqual([25000, 4000]); // each team's price
    expect(checkouts[0].lines.slice(0, 2).every((l) => l.name.startsWith("Winter: "))).toBe(true);
    expect(checkouts[0].lines[2].cents).toBe(cardFee(29000));
    expect(checkouts[0].lines.at(-1)!.name).toBe("Card processing");
    expect(checkouts[0].cancelUrl).toBe("https://app.test/org/hixson-hoops?open=register&paid=cancelled");

    const id = done.pay!.split("cs_test_")[1];
    const pdeps = { pool: db.pool, stripe, now: deps.now };
    expect(await confirmPayment(pdeps, id, `cs_test_${id}`)).toMatchObject({ ok: true, registered: false });
    paid.add(`cs_test_${id}`);
    expect(await confirmPayment(pdeps, id, `cs_test_${id}`)).toEqual({
      ok: true,
      registered: true,
      teamPage: "/org/hixson-hoops?open=teams",
      message: "Paid and registered 2 teams.",
      paidNow: { programId: prog, org: "hixson-hoops" }, // its invoice is emailed (once)
    });
    const regs = await db.pool.query("select paid, paid_set_by from scenic_registrations");
    expect(regs.rows).toEqual([
      { paid: true, paid_set_by: "Card (Stripe)" },
      { paid: true, paid_set_by: "Card (Stripe)" },
    ]);
    // Again (Stripe's notice and the way back both arrive): still once.
    expect(await confirmPayment(pdeps, id, `cs_test_${id}`)).toMatchObject({ ok: true, registered: true });
    expect((await db.pool.query("select count(*)::int n from scenic_registrations")).rows[0].n).toBe(2);
  }, 60_000);
});
