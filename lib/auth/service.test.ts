import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, grant, testClock, testMailer, THUNDER_ROLES } from "../testing/db";
import { hashPin } from "./crypto";
import * as auth from "./service";
import { MSG, type Deps, type Step } from "./service";

let db: Awaited<ReturnType<typeof createTestDb>>;
let clock: ReturnType<typeof testClock>;
let mail: ReturnType<typeof testMailer>;
let deps: Deps;

beforeAll(async () => {
  db = await createTestDb();
}, 30_000);
afterAll(async () => {
  await db?.drop();
});
beforeEach(async () => {
  await db.reset();
  clock = testClock();
  mail = testMailer();
  deps = { pool: db.pool, sendEmail: mail.sendEmail, now: clock.now };
});

const CELL = "4235551234";

async function addUser(o: {
  cell?: string;
  pin?: string | null;
  email?: string | null;
  verified?: boolean;
  coach?: boolean;
  director?: boolean;
  active?: boolean;
  request?: boolean;
}) {
  const cell = o.cell ?? CELL;
  const email = o.email === undefined ? "earl@example.com" : o.email;
  await db.pool.query(
    `insert into users (coach_id, first_name, last_name, active, pin_hash, cell, email, verified_email)
     values ($1, 'Earl', 'Epps', $2, $3, $4, $5, $6)`,
    [cell.slice(-7), o.active ?? true, o.pin === null ? null : await hashPin(o.pin ?? "5678"), cell, email, o.verified === false ? null : email],
  );
  const id = cell.slice(-7);
  if (o.request) await grant(db.pool, `${id} thunder Request`);
  if (o.coach ?? true) await grant(db.pool, `${id} thunder Coach`);
  if (o.director) await grant(db.pool, `${id} thunder Director`);
}

async function userRow(cell = CELL) {
  return (await db.pool.query(`select *, ${THUNDER_ROLES} from users where cell = $1`, [cell])).rows[0];
}

function expectError(s: Step, message?: string | RegExp) {
  expect(s.step).toBe("error");
  if (message && s.step === "error") {
    if (typeof message === "string") expect(s.message).toBe(message);
    else expect(s.message).toMatch(message);
  }
}

function token(s: Step): string {
  if (s.step !== "loggedIn") throw new Error(`Expected loggedIn, got ${JSON.stringify(s)}`);
  return s.token;
}

describe("phone step", () => {
  it("rejects bad numbers", async () => {
    expectError(await auth.lookupPhone(deps, "555-1234"), MSG.badPhone);
  });

  it("unknown number goes to Create Account", async () => {
    expect(await auth.lookupPhone(deps, "(423) 555-1234")).toEqual({ step: "create" });
  });

  it("inactive account is deactivated", async () => {
    await addUser({ active: false });
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "done", message: MSG.deactivated });
  });

  it("pending request is still pending", async () => {
    await addUser({ coach: false, request: true });
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "done", message: MSG.pending });
  });

  it("normal account goes to the PIN step", async () => {
    await addUser({});
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "pin" });
  });
});

describe("create account", () => {
  const form = { cell: CELL, firstName: "Earl", lastName: "Epps", email: "Earl@Example.com", pin1: "2468", pin2: "2468" };

  it("validates before sending anything", async () => {
    expectError(await auth.startSignup(deps, { ...form, firstName: "=HACK()" }), MSG.badName);
    expectError(await auth.startSignup(deps, { ...form, email: "nope" }), MSG.badEmail);
    expectError(await auth.startSignup(deps, { ...form, pin2: "1357" }), MSG.pinMismatch);
    expectError(await auth.startSignup(deps, { ...form, pin1: "1234", pin2: "1234" }), MSG.pinStarter);
    expect(mail.sent).toHaveLength(0);
  });

  it("emails a code and saves nothing until it checks out", async () => {
    const s = await auth.startSignup(deps, form);
    expect(s).toEqual({ step: "signupCode", maskedEmail: "e***@example.com" });
    expect(mail.sent[0].to).toBe("earl@example.com");
    expect(await userRow()).toBeUndefined();

    expectError(await auth.completeSignup(deps, CELL, "000000"), /Wrong code. 4 tries left/);
    expect(await userRow()).toBeUndefined();

    const done = await auth.completeSignup(deps, CELL, mail.lastCode());
    expect(done).toEqual({ step: "done", message: MSG.requested });
    const u = await userRow();
    expect(u).toMatchObject({
      coach_id: "5551234",
      first_name: "Earl",
      email: "earl@example.com",
      verified_email: "earl@example.com",
      thunder_request: true,
      thunder_coach: false,
      active: true,
    });
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "done", message: MSG.pending });
  });

  it("refuses a number whose last 7 digits match an existing user", async () => {
    await addUser({ cell: "6155551234" });
    expectError(await auth.startSignup(deps, form), MSG.taken);
  });

  it("a code can't be used twice", async () => {
    await auth.startSignup(deps, form);
    const code = mail.lastCode();
    await auth.completeSignup(deps, CELL, code);
    expectError(await auth.completeSignup(deps, CELL, code), MSG.codeExpired);
  });
});

describe("email codes", () => {
  const form = { cell: CELL, firstName: "Earl", lastName: "Epps", email: "earl@example.com", pin1: "2468", pin2: "2468" };

  it("expire after 15 minutes", async () => {
    await auth.startSignup(deps, form);
    clock.advanceMinutes(15);
    expectError(await auth.completeSignup(deps, CELL, mail.lastCode()), MSG.codeExpired);
  });

  it("die after 5 wrong tries, even if the right code follows", async () => {
    await auth.startSignup(deps, form);
    for (let i = 0; i < 4; i++) await auth.completeSignup(deps, CELL, "000000");
    expectError(await auth.completeSignup(deps, CELL, "000000"), MSG.codeDead);
    expectError(await auth.completeSignup(deps, CELL, mail.lastCode()), MSG.codeDead);
  });

  it("only the newest code works", async () => {
    await auth.startSignup(deps, form);
    const first = mail.lastCode();
    await auth.startSignup(deps, form);
    const second = mail.lastCode();
    if (first !== second) expectError(await auth.completeSignup(deps, CELL, first));
    expect((await auth.completeSignup(deps, CELL, second)).step).toBe("done");
  });

  it("max 3 emails per hour per person", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await auth.startSignup(deps, form)).step).toBe("signupCode");
      clock.advanceMinutes(10);
    }
    expectError(await auth.startSignup(deps, form), /Too many codes sent. Try again in 30 minutes/);
    expect(mail.sent).toHaveLength(3);
    clock.advanceMinutes(30);
    expect((await auth.startSignup(deps, form)).step).toBe("signupCode");
  });

  it("a failed send doesn't count and saves nothing", async () => {
    deps.sendEmail = async () => {
      throw new Error("mail down");
    };
    await expect(auth.startSignup(deps, form)).rejects.toThrow("mail down");
    const n = await db.pool.query("select count(*)::int as n from email_codes");
    expect(n.rows[0].n).toBe(0);
  });
});

describe("starter PIN 1234", () => {
  it("with email on file: skips PIN, emails that address immediately", async () => {
    await addUser({ pin: "1234", verified: false });
    const s = await auth.lookupPhone(deps, CELL);
    expect(s).toEqual({ step: "starterCode", maskedEmail: "e***@example.com" });
    expect(mail.sent[0].to).toBe("earl@example.com");
  });

  it("the email on file can't be swapped", async () => {
    await addUser({ pin: "1234" });
    await auth.sendStarterCode(deps, CELL, "other@example.com");
    expect(mail.sent.every((m) => m.to === "earl@example.com")).toBe(true);
  });

  it("no PIN at all counts as the starter PIN", async () => {
    await addUser({ pin: null });
    expect((await auth.lookupPhone(deps, CELL)).step).toBe("starterCode");
  });

  it("Set Your PIN: new PIN twice, not 1234, then logged in and verified", async () => {
    await addUser({ pin: "1234", verified: false });
    await auth.lookupPhone(deps, CELL);
    const code = mail.lastCode();
    expectError(await auth.completeStarter(deps, CELL, code, "1234", "1234"), MSG.pinStarter);
    expectError(await auth.completeStarter(deps, CELL, code, "2468", "1357"), MSG.pinMismatch);
    token(await auth.completeStarter(deps, CELL, code, "2468", "2468"));
    expect(await userRow()).toMatchObject({ email: "earl@example.com", verified_email: "earl@example.com" });
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "pin" });
    token(await auth.submitPin(deps, CELL, "2468"));
  });

  it("with no email: asks for one, then sends the code there", async () => {
    await addUser({ pin: "1234", email: null });
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "starterEmail" });
    expectError(await auth.sendStarterCode(deps, CELL, "bad"), MSG.badEmail);
    expect(await auth.sendStarterCode(deps, CELL, "New@Example.com")).toEqual({
      step: "starterCode",
      maskedEmail: "n***@example.com",
    });
    token(await auth.completeStarter(deps, CELL, mail.lastCode(), "2468", "2468"));
    expect(await userRow()).toMatchObject({ email: "new@example.com", verified_email: "new@example.com" });
  });

  it("typing 1234 on the PIN step never logs in", async () => {
    await addUser({ pin: "1234" });
    const s = await auth.submitPin(deps, CELL, "1234");
    expect(s.step).toBe("starterCode");
  });
});

describe("local testing bypass", () => {
  it("when on: phone + 123456 logs any active account in, no PIN, no email", async () => {
    await addUser({ email: null, coach: false, request: true });
    deps.devStarterBypass = true;
    deps.devFixedCode = "123456";
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "devCode" });
    expectError(await auth.devLogin(deps, CELL, "000000"), /Wrong code/);
    token(await auth.devLogin(deps, CELL, "123456"));
    expect(mail.sent).toHaveLength(0);
  });

  it("when on: inactive accounts still can't get in", async () => {
    await addUser({ active: false });
    deps.devStarterBypass = true;
    deps.devFixedCode = "123456";
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "done", message: MSG.deactivated });
    expect((await auth.devLogin(deps, CELL, "123456")).step).toBe("done");
  });

  it("when on: Create Account + 123456 makes a Director and logs in", async () => {
    deps.devStarterBypass = true;
    deps.devFixedCode = "123456";
    await auth.startSignup(deps, { cell: CELL, firstName: "Earl", lastName: "Epps", email: "e@example.com", pin1: "2468", pin2: "2468" });
    token(await auth.completeSignup(deps, CELL, "123456"));
    expect(await userRow()).toMatchObject({ thunder_director: true, thunder_request: false });
  });

  it("when off: devLogin does nothing", async () => {
    await addUser({});
    deps.devFixedCode = "123456";
    expectError(await auth.devLogin(deps, CELL, "123456"), "Not available.");
  });

  it("when on: doesn't help anyone with a real PIN", async () => {
    await addUser({});
    deps.devStarterBypass = true;
    expectError(await auth.submitPin(deps, CELL, "1234"), /Wrong PIN/);
  });

  it("fixed code: always 123456, no email, no hourly limit; wrong codes still count", async () => {
    await addUser({});
    deps.devFixedCode = "123456";
    for (let i = 0; i < 4; i++) expect((await auth.startForgot(deps, CELL)).step).toBe("resetCode");
    expect(mail.sent).toHaveLength(0);
    expectError(await auth.completeReset(deps, CELL, "000000", "2468", "2468"), /Wrong code. 4 tries left/);
    token(await auth.completeReset(deps, CELL, "123456", "2468", "2468"));
  });

  it("when off (the default): normal starter rules", async () => {
    await addUser({ pin: "1234" });
    expect((await auth.submitPin(deps, CELL, "1234")).step).toBe("starterCode");
  });
});

describe("PIN only (until go-live)", () => {
  beforeEach(() => {
    deps.pinOnly = true;
  });

  it("the PIN on file logs in, even with an unverified email and no email sent", async () => {
    await addUser({ verified: false });
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "pin" });
    token(await auth.submitPin(deps, CELL, "5678"));
    expect(mail.sent).toHaveLength(0);
  });

  it("starter PIN 1234: email code, then Set Your PIN, then logged in with the email verified", async () => {
    await addUser({ pin: "1234", verified: false });
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "starterCode", maskedEmail: "e***@example.com" });
    expect((await auth.submitPin(deps, CELL, "1234")).step).toBe("starterCode");
    expectError(await auth.completeStarter(deps, CELL, mail.lastCode(), "1234", "1234"), MSG.pinStarter);
    token(await auth.completeStarter(deps, CELL, mail.lastCode(), "2468", "2468"));
    expect(await userRow()).toMatchObject({ verified_email: "earl@example.com" });
    token(await auth.submitPin(deps, CELL, "2468"));
  });

  it("starter PIN with no email on file asks for one", async () => {
    await addUser({ pin: null, email: null });
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "starterEmail" });
  });

  it("wrong PINs still count and lock the number", async () => {
    await addUser({});
    for (let i = 4; i >= 1; i--) expectError(await auth.submitPin(deps, CELL, "0000"), new RegExp(`${i} tr`));
    expectError(await auth.submitPin(deps, CELL, "0000"), MSG.locked);
    expectError(await auth.submitPin(deps, CELL, "5678"), MSG.locked);
  });

  it("no PIN stored counts as the starter PIN: email code, not a login", async () => {
    await addUser({ pin: null });
    expect((await auth.lookupPhone(deps, CELL)).step).toBe("starterCode");
    expect((await auth.submitPin(deps, CELL, "1234")).step).toBe("starterCode");
  });

  it("inactive and pending people are still stopped", async () => {
    await addUser({ active: false });
    expect(await auth.submitPin(deps, CELL, "5678")).toEqual({ step: "done", message: MSG.deactivated });
    await addUser({ cell: "4235550000", coach: false, request: true });
    expect(await auth.submitPin(deps, "4235550000", "5678")).toEqual({ step: "done", message: MSG.pending });
  });

  it("Create Account (a number not in the users list) still verifies the email with a code", async () => {
    const s = await auth.startSignup(deps, {
      cell: CELL,
      firstName: "Earl",
      lastName: "Epps",
      email: "e@example.com",
      pin1: "2468",
      pin2: "2468",
    });
    expect(s).toEqual({ step: "signupCode", maskedEmail: "e***@example.com" });
    expect(mail.sent[0].to).toBe("e@example.com");
    expect(await userRow()).toBeUndefined();
    expect(await auth.completeSignup(deps, CELL, mail.lastCode())).toEqual({ step: "done", message: MSG.requested });
    expect(await userRow()).toMatchObject({
      thunder_request: true,
      thunder_director: false,
      email: "e@example.com",
      verified_email: "e@example.com",
    });
  });

  it("Forgot PIN says to ask the Director", async () => {
    await addUser({});
    expectError(await auth.startForgot(deps, CELL), MSG.askDirector);
    expect(mail.sent).toHaveLength(0);
  });
});

describe("PIN step", () => {
  it("correct PIN + verified email logs in", async () => {
    await addUser({ director: true });
    const t = token(await auth.submitPin(deps, CELL, "5678"));
    expect(await auth.getSessionUser(deps, t)).toMatchObject({
      coachId: "5551234",
      firstName: "Earl",
      isDirector: true,
      isCoach: true,
      hasThunderRole: true,
    });
  });

  it("counts down wrong tries, locks for 15 minutes on the 5th", async () => {
    await addUser({});
    for (let left = 4; left >= 1; left--) {
      expectError(await auth.submitPin(deps, CELL, "0000"), `Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left.`);
    }
    expectError(await auth.submitPin(deps, CELL, "0000"), MSG.locked);
    expectError(await auth.submitPin(deps, CELL, "5678"), MSG.locked); // right PIN still refused
    clock.advanceMinutes(14);
    expectError(await auth.submitPin(deps, CELL, "5678"), MSG.locked);
    clock.advanceMinutes(1);
    token(await auth.submitPin(deps, CELL, "5678"));
  });

  it("a correct PIN resets the wrong-try count", async () => {
    await addUser({});
    for (let i = 0; i < 4; i++) await auth.submitPin(deps, CELL, "0000");
    token(await auth.submitPin(deps, CELL, "5678"));
    expectError(await auth.submitPin(deps, CELL, "0000"), "Wrong PIN. 4 tries left.");
  });
});

describe("email not verified", () => {
  it("correct PIN asks to verify, code to email on file, then logged in", async () => {
    await addUser({ verified: false });
    expect(await auth.submitPin(deps, CELL, "5678")).toEqual({ step: "verifyChoice", maskedEmail: "e***@example.com" });
    expect(await auth.sendVerifyCode(deps, CELL, "5678", null)).toEqual({ step: "verifyCode", maskedEmail: "e***@example.com" });
    expect(await userRow()).toMatchObject({ verified_email: null }); // nothing saved yet
    token(await auth.completeVerify(deps, CELL, "5678", mail.lastCode()));
    expect(await userRow()).toMatchObject({ email: "earl@example.com", verified_email: "earl@example.com" });
  });

  it("can use a different email", async () => {
    await addUser({ verified: false });
    await auth.sendVerifyCode(deps, CELL, "5678", "coach@example.com");
    expect(mail.sent[0].to).toBe("coach@example.com");
    token(await auth.completeVerify(deps, CELL, "5678", mail.lastCode()));
    expect(await userRow()).toMatchObject({ email: "coach@example.com", verified_email: "coach@example.com" });
  });

  it("needs the right PIN to send or use a code", async () => {
    await addUser({ verified: false });
    expectError(await auth.sendVerifyCode(deps, CELL, "0000", null), /Wrong PIN/);
    expect(mail.sent).toHaveLength(0);
    await auth.sendVerifyCode(deps, CELL, "5678", null);
    expectError(await auth.completeVerify(deps, CELL, "0000", mail.lastCode()), /Wrong PIN/);
  });

  it("counts as unverified when Email differs from VerifiedEmail", async () => {
    await addUser({});
    await db.pool.query("update users set email = 'changed@example.com'");
    expect((await auth.submitPin(deps, CELL, "5678")).step).toBe("verifyChoice");
  });
});

describe("Forgot PIN", () => {
  it("sends only to the verified email, resets PIN, clears lockout", async () => {
    await addUser({});
    for (let i = 0; i < 5; i++) await auth.submitPin(deps, CELL, "0000");
    expectError(await auth.submitPin(deps, CELL, "5678"), MSG.locked);

    expect(await auth.startForgot(deps, CELL)).toEqual({ step: "resetCode", maskedEmail: "e***@example.com" });
    expect(mail.sent[0].to).toBe("earl@example.com");
    expectError(await auth.completeReset(deps, CELL, mail.lastCode(), "1234", "1234"), MSG.pinStarter);
    token(await auth.completeReset(deps, CELL, mail.lastCode(), "9753", "9753"));

    expectError(await auth.submitPin(deps, CELL, "5678"), "Wrong PIN. 4 tries left.");
    token(await auth.submitPin(deps, CELL, "9753"));
  });

  it("no verified email: contact the Director", async () => {
    await addUser({ verified: false });
    expectError(await auth.startForgot(deps, CELL), MSG.noVerifiedEmail);
    expect(mail.sent).toHaveLength(0);
  });
});

describe("no Thunder role", () => {
  it("logs in, then Request Access sets the request flag", async () => {
    await addUser({ coach: false });
    const t = token(await auth.submitPin(deps, CELL, "5678"));
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ hasThunderRole: false, requestPending: false });
    expect(await auth.requestAccess(deps, t)).toEqual({ step: "done", message: MSG.requested });
    expect(await userRow()).toMatchObject({ thunder_request: true });
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ requestPending: true });
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "done", message: MSG.pending });
  });
});

describe("team staff", () => {
  it("a place on a team's staff counts as a Thunder role", async () => {
    await addUser({ coach: false, request: true });
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "done", message: MSG.pending });
    const team = await db.pool.query<{ id: string }>(
      "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Test', 'Girls', '{4}', 4, 'REC', 'x') returning id",
    );
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, $2, 'TeamParent', 'x')", [
      team.rows[0].id,
      CELL.slice(-7),
    ]);
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "pin" });
    const t = token(await auth.submitPin(deps, CELL, "5678"));
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ hasThunderRole: true, requestPending: false, isCoach: false });
    // Taken off the team: access goes on the next request.
    await db.pool.query("delete from team_staff");
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ hasThunderRole: false, requestPending: true });
  });
});

describe("Scenic City roles", () => {
  it("Create Account from the join link logs straight in, with no Thunder request", async () => {
    await auth.startSignup(deps, { cell: CELL, firstName: "Earl", lastName: "Epps", email: "e@example.com", pin1: "1357", pin2: "1357", join: "scenic-city" });
    const t = token(await auth.completeSignup(deps, CELL, mail.lastCode()));
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ coachId: "5551234", hasThunderRole: false, requestPending: false });
    expect((await db.pool.query("select count(*)::int n from org_roles")).rows[0].n).toBe(0);
  });

  it("an unknown join value is ignored (normal Thunder request)", async () => {
    await auth.startSignup(deps, { cell: CELL, firstName: "Earl", lastName: "Epps", email: "e@example.com", pin1: "1357", pin2: "1357", join: "nope" });
    expect(await auth.completeSignup(deps, CELL, mail.lastCode())).toEqual({ step: "done", message: MSG.requested });
    expect(await userRow()).toMatchObject({ thunder_request: true });
  });

  it("a Scenic City role alone lets a person log in; a Request alone is pending", async () => {
    await addUser({ coach: false });
    await grant(db.pool, "5551234 scenic-city Request");
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "done", message: MSG.pending });
    await grant(db.pool, "5551234 scenic-city Partner");
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "pin" });
    const t = token(await auth.submitPin(deps, CELL, "5678"));
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ hasThunderRole: false, requestPending: false, isDirector: false });
  });

  it("a pending Thunder request doesn't block someone who holds a Scenic City role", async () => {
    await addUser({ coach: false, request: true });
    await grant(db.pool, "5551234 scenic-city Director");
    expect(await auth.lookupPhone(deps, CELL)).toEqual({ step: "pin" });
  });
});

describe("sessions", () => {
  it("last 24 hours from the PIN login, then the PIN is needed again", async () => {
    await addUser({});
    const t = token(await auth.submitPin(deps, CELL, "5678"));
    clock.advanceMinutes(24 * 60 - 1);
    expect(await auth.getSessionUser(deps, t)).not.toBeNull();
    clock.advanceMinutes(1);
    expect(await auth.getSessionUser(deps, t)).toBeNull();
  });

  it("roles are re-read on every request", async () => {
    await addUser({ director: true });
    const t = token(await auth.submitPin(deps, CELL, "5678"));
    await db.pool.query("delete from org_roles where role = 'Director'");
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ isDirector: false });
  });

  it("deactivating ends the session at once", async () => {
    await addUser({});
    const t = token(await auth.submitPin(deps, CELL, "5678"));
    await db.pool.query("update users set active = false");
    expect(await auth.getSessionUser(deps, t)).toBeNull();
  });

  it("act as: an Admin views as someone else (re-checked every request); Stop or losing Admin ends it", async () => {
    await addUser({ director: true });
    await grant(db.pool, "5551234 thunder Admin");
    await addUser({ cell: "4235550002", email: "pat@example.com", coach: true });
    const t = token(await auth.submitPin(deps, CELL, "5678"));
    expect(await auth.setActingAs(deps, t, "5550002")).toEqual({ ok: true });
    expect(await auth.getSessionUser(deps, t)).toMatchObject({
      coachId: "5550002",
      isDirector: false,
      actingBy: { coachId: "5551234", name: "Earl Epps" },
    });

    // Losing Admin ends it at once; getting it back resumes.
    await db.pool.query("delete from org_roles where coach_id = '5551234' and role = 'Admin'");
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ coachId: "5551234", isAdmin: false });
    expect((await auth.getSessionUser(deps, t))?.actingBy).toBeUndefined();
    await grant(db.pool, "5551234 thunder Admin");

    // The other person deactivated: back to yourself.
    await db.pool.query("update users set active = false where coach_id = '5550002'");
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ coachId: "5551234" });
    await db.pool.query("update users set active = true where coach_id = '5550002'");

    expect(await auth.setActingAs(deps, t, null)).toEqual({ ok: true });
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ coachId: "5551234", isDirector: true, isAdmin: true });
    expect(await auth.setActingAs(deps, t, "5551234")).toEqual({ ok: false, message: "Pick someone else." });
    expect(await auth.setActingAs(deps, t, "9999999")).toEqual({ ok: false, message: "Only active users can be viewed." });
  });

  it("act as: only an Admin can start it (a Director isn't enough)", async () => {
    await addUser({ director: true });
    await addUser({ cell: "4235550002", email: "pat@example.com" });
    const t = token(await auth.submitPin(deps, CELL, "5678"));
    expect(await auth.setActingAs(deps, t, "5550002")).toEqual({ ok: false, message: "Only an Admin can view the app as someone else." });
    expect(await auth.setActingAs(deps, "junk", "5550002")).toEqual({ ok: false, message: "Please log in again." });
  });

  it("act as: a Scenic City Admin views Scenic City people only; leaving the organization ends it", async () => {
    await addUser({}); // Earl: no Thunder role
    await grant(db.pool, "5551234 scenic-city Director", "5551234 scenic-city Admin");
    await addUser({ cell: "4235550002", email: "pat@example.com" });
    await grant(db.pool, "5550002 scenic-city Partner");
    await addUser({ cell: "4235550003", email: "cy@example.com", coach: true }); // Thunder only
    const t = token(await auth.submitPin(deps, CELL, "5678"));

    expect(await auth.setActingAs(deps, t, "5550003")).toEqual({ ok: false, message: "You can only view people in your organization." });
    expect(await auth.setActingAs(deps, t, "5550002")).toEqual({ ok: true });
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ coachId: "5550002", actingBy: { coachId: "5551234" } });

    // Pat leaves Scenic City: back to yourself at once.
    await db.pool.query("delete from org_roles where coach_id = '5550002'");
    expect(await auth.getSessionUser(deps, t)).toMatchObject({ coachId: "5551234" });
    expect((await auth.getSessionUser(deps, t))?.actingBy).toBeUndefined();
  });

  it("logout deletes the session; junk tokens get nothing", async () => {
    await addUser({});
    const t = token(await auth.submitPin(deps, CELL, "5678"));
    await auth.logout(deps, t);
    expect(await auth.getSessionUser(deps, t)).toBeNull();
    expect((await db.pool.query("select count(*)::int as n from sessions")).rows[0].n).toBe(0);
    expect(await auth.getSessionUser(deps, "junk")).toBeNull();
    expect(await auth.getSessionUser(deps, undefined)).toBeNull();
  });
});

