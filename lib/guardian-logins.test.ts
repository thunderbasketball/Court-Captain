import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { guardianLogins } from "./guardian-logins";
import { createTestDb, grant } from "./testing/db";

describe("parents' logins on Members", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  it("verified or not for everyone who sees the list; View as and Reset only for Admins, never yourself", async () => {
    await db.pool.query(`insert into users (coach_id, first_name, last_name, cell, email, verified_email, active) values
      ('5550001', 'Ada', 'A', '4235550001', 'a@x.com', 'a@x.com', true), ('5550002', 'Pat', 'P', '4235550002', 'P@x.com', 'p@x.com', true),
      ('5550003', 'Quin', 'P', '4235550003', 'q@x.com', null, true), ('5550004', 'Off', 'P', '4235550004', null, null, false)`);
    await grant(db.pool, "5550001 thunder Owner", "5550001 thunder Admin", "5550002 thunder Family");
    const cells = ["4235550001", "4235550002", "4235550003", "4235550004", "4235559999", "12", null];
    const ada = { coachId: "5550001", firstName: "Ada", lastName: "A", isDirector: true, isAdmin: true } as unknown as SessionUser;
    const look = async (v: SessionUser) => Object.fromEntries([...(await guardianLogins(db.pool, v, cells))].map(([c, l]) => [c.slice(-1), [l.verified, l.viewAs, l.reset]]));
    expect(await look(ada)).toEqual({ 1: [true, false, false], 2: [true, true, true], 3: [false, true, false] });
    const none = { 1: [true, false, false], 2: [true, false, false], 3: [false, false, false] };
    expect(await look({ ...ada, isAdmin: false } as SessionUser)).toEqual(none); // a Director
    expect(await look({ ...ada, actingBy: "x" } as unknown as SessionUser)).toEqual(none); // viewing as them
    expect(await guardianLogins(db.pool, ada, [null, ""])).toEqual(new Map());
  }, 60_000);
});
