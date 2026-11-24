import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, testClock, testMailer, grant } from "../testing/db";
import { hashPin } from "./crypto";
import { bearerToken, mobileLoginStep } from "./mobile";
import * as auth from "./service";
import { MSG, type Deps } from "./service";

let db: Awaited<ReturnType<typeof createTestDb>>;
let deps: Deps;

beforeAll(async () => {
  db = await createTestDb();
}, 180_000);
afterAll(async () => {
  await db?.drop();
});
beforeEach(async () => {
  await db.reset();
  deps = { pool: db.pool, sendEmail: testMailer().sendEmail, now: testClock().now };
});

const CELL = "4235551234";

async function addUser() {
  await db.pool.query(
    `insert into users (coach_id, first_name, last_name, active, pin_hash, cell, email, verified_email)
     values ('5551234', 'Earl', 'Epps', true, $1, $2, 'earl@example.com', 'earl@example.com')`,
    [await hashPin("5678"), CELL],
  );
  await grant(db.pool, "5551234 thunder Coach");
}

describe("phone app login", () => {
  it("phone, then PIN, gives a token that finds the user", async () => {
    await addUser();
    expect(await mobileLoginStep(deps, { action: "lookupPhone", cell: CELL })).toEqual({ step: "pin" });
    const s = await mobileLoginStep(deps, { action: "submitPin", cell: CELL, pin: "5678" });
    if (s.step !== "loggedIn") throw new Error(JSON.stringify(s));
    const user = await auth.getSessionUser(deps, bearerToken(`Bearer ${s.token}`));
    expect(user?.firstName).toBe("Earl");
  });

  it("keeps the website's PIN rules", async () => {
    await addUser();
    const s = await mobileLoginStep(deps, { action: "submitPin", cell: CELL, pin: "0000" });
    expect(s).toEqual({ step: "error", message: "Wrong PIN. 4 tries left." });
    expect(await mobileLoginStep(deps, { action: "lookupPhone", cell: "555" })).toEqual({ step: "error", message: MSG.badPhone });
  });

  it("rejects unknown actions and junk", async () => {
    for (const body of [null, "x", 42, {}, { action: "requestAccess" }, { action: "logout" }]) {
      expect((await mobileLoginStep(deps, body)).step).toBe("error");
    }
  });

  it("testing-mode login stays off unless the server allows it", async () => {
    await addUser();
    expect(await mobileLoginStep(deps, { action: "devLogin", cell: CELL, code: "123456" })).toEqual({
      step: "error",
      message: "Not available.",
    });
  });
});

describe("bearerToken", () => {
  it("reads only a well-formed Bearer header", () => {
    const t = "a".repeat(43);
    expect(bearerToken(`Bearer ${t}`)).toBe(t);
    expect(bearerToken(null)).toBeUndefined();
    expect(bearerToken(t)).toBeUndefined();
    expect(bearerToken("Bearer short")).toBeUndefined();
    expect(bearerToken(`Bearer ${t} extra`)).toBeUndefined();
  });
});
