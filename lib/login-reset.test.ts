import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { hashPin } from "./auth/crypto";
import { resetOrgLogin, resettable } from "./login-reset";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: true,
});
const owner = person("5550001", "Olive");
const admin = person("5550002", "Ann");
const director = person("5550004", "Dee");
const staff = person("5550008", "Pam"); // CourtCaptain staff
const NOW = new Date("2026-11-03T15:00:00Z");

describe("reset login", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => NOW });
  const user = async (id: string) => (await db.pool.query("select * from users where coach_id = $1", [id])).rows[0];

  beforeEach(async () => {
    await db.reset();
    const people = ["Olive", "Ann", "Abe", "Dee", "Cal", "Xena", "Sid", "Pam"];
    for (const [i, first] of people.entries())
      await db.pool.query(
        "insert into users (coach_id, first_name, last_name, cell, email, verified_email) values ($1, $2, 'X', $3, $4, $4)",
        [`555000${i + 1}`, first, `423555000${i + 1}`, `${first.toLowerCase()}@example.com`],
      );
    await grant(
      db.pool,
      "5550001 thunder Owner",
      "5550001 thunder Admin",
      "5550002 thunder Admin",
      "5550003 thunder Admin",
      "5550004 thunder Director",
      "5550005 thunder Coach",
      "5550006 thunder Coach",
      "5550006 scenic-city Admin", // a leader in another organization
      "5550007 scenic-city Coach", // not in Thunder
      "5550008 thunder Coach",
    );
    await db.pool.query("insert into platform_admins (coach_id, granted_by) values ('5550008', 'test')");
  });

  it("PIN back to 1234, email cleared, logged out, lockout and codes cleared, who did it recorded", async () => {
    await db.pool.query("update users set pin_hash = $1 where coach_id = '5550005'", [await hashPin("2468")]);
    await db.pool.query("insert into sessions (token_hash, coach_id, created_at, expires_at) values ('x', '5550005', $1, $1)", [
      NOW,
    ]);
    await db.pool.query("insert into pin_lockouts (cell, failed_count) values ('4235550005', 3)");
    expect(await resetOrgLogin(deps(), admin, "thunder", "5550005")).toEqual({ ok: true });
    expect(await user("5550005")).toMatchObject({
      pin_hash: null,
      email: null,
      verified_email: null,
      updated_by: "Ann X",
      first_name: "Cal",
    });
    expect((await db.pool.query("select count(*)::int n from sessions where coach_id = '5550005'")).rows[0].n).toBe(0);
    expect((await db.pool.query("select count(*)::int n from pin_lockouts where cell = '4235550005'")).rows[0].n).toBe(0);
  });

  it("Owners reset anyone in their organization; Admins everyone but Owners and Admins; Directors no one", async () => {
    const all = ["5550001", "5550002", "5550003", "5550004", "5550005", "5550006", "5550007", "5550008"];
    // Owners: other Owners and Admins too. Not Xena (an Admin of Scenic City), Sid (not in Thunder) or CourtCaptain staff.
    expect([...(await resettable(db.pool, owner.coachId, "thunder", all))].sort()).toEqual([
      "5550002",
      "5550003",
      "5550004",
      "5550005",
    ]);
    // Admins: not Owners or other Admins.
    expect([...(await resettable(db.pool, admin.coachId, "thunder", all))].sort()).toEqual(["5550004", "5550005"]);
    expect((await resettable(db.pool, director.coachId, "thunder", all)).size).toBe(0);

    expect(await resetOrgLogin(deps(), owner, "thunder", "5550002")).toEqual({ ok: true });
    expect(await resetOrgLogin(deps(), admin, "thunder", "5550001")).toMatchObject({ ok: false, message: /Only an Owner/ });
    expect(await resetOrgLogin(deps(), admin, "thunder", "5550003")).toMatchObject({ ok: false });
    expect(await resetOrgLogin(deps(), admin, "thunder", "5550002")).toEqual({
      ok: false,
      message: "You can't reset your own login.",
    });
    expect(await resetOrgLogin(deps(), director, "thunder", "5550005")).toMatchObject({ ok: false });
    expect(await resetOrgLogin(deps(), owner, "thunder", "5550006")).toMatchObject({ ok: false }); // Scenic City's Admin
    expect(await resetOrgLogin(deps(), owner, "thunder", "5550007")).toMatchObject({ ok: false }); // not in Thunder
    expect(await resetOrgLogin(deps(), owner, "thunder", "5550008")).toMatchObject({ ok: false }); // CourtCaptain staff
    expect((await user("5550001")).email).toBe("olive@example.com"); // nothing changed on a refusal
  });

  it("CourtCaptain staff reset any organization's Owners, from the CourtCaptain page", async () => {
    expect(await resetOrgLogin(deps(), staff, "thunder", "5550001")).toEqual({ ok: true });
    expect(await resetOrgLogin(deps(), staff, "scenic-city", "5550006")).toEqual({ ok: true });
    expect(await user("5550001")).toMatchObject({ pin_hash: null, email: null, updated_by: "Pam X" });
  });
});
