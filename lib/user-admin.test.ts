import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { createTestDb, grant, THUNDER_ROLES } from "./testing/db";
import { addUser, deleteUser, denyRequest, updateUser, approveJoin } from "./user-admin";

const director: SessionUser = {
  coachId: "9913694",
  firstName: "Earl",
  lastName: "Epps",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: true,
};
const coach: SessionUser = { ...director, coachId: "5550001", isDirector: false, isCoach: true };

describe("user admin", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  const now = new Date("2026-10-28T12:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const user = async (id: string) =>
    (
      await db.pool.query(
        `select *, ${THUNDER_ROLES}, has_role(coach_id, 'scenic-city', 'Coach') as scenic_city_coach from users where coach_id = $1`,
        [id],
      )
    ).rows[0];
  const edit = { first: "Pat", last: "Test", email: "pat@example.com", active: true, coach: true };

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell, email, verified_email) values
         ('9913694', 'Earl', 'Epps', '4239913694', null, null),
         ('5550001', 'Pat', 'Test', '4235550001', 'pat@example.com', 'pat@example.com'),
         ('5550002', 'Sam', 'Scenic', '4235550002', null, null)`,
    );
    await grant(db.pool, "9913694 thunder Director", "5550001 thunder Request", "5550002 scenic-city Coach");
  });

  it("edits name, email, Active and Coach, records who did it, and leaves Director and Scenic City roles alone", async () => {
    expect(
      await updateUser(deps(), director, "5550002", {
        first: "Samuel",
        last: "Scenic",
        email: "Sam@Example.com",
        active: false,
        coach: true,
      }),
    ).toEqual({ ok: true });
    expect(await user("5550002")).toMatchObject({
      first_name: "Samuel",
      email: "sam@example.com",
      active: false,
      thunder_coach: true,
      thunder_director: false,
      scenic_city_coach: true,
      updated_by: "Earl Epps",
    });
  });

  it("granting a role approves a pending request", async () => {
    await updateUser(deps(), director, "5550001", edit);
    expect(await user("5550001")).toMatchObject({ thunder_request: false, thunder_coach: true });
  });

  it("deny clears the request without a role", async () => {
    await denyRequest(deps(), director, "5550001");
    expect(await user("5550001")).toMatchObject({ thunder_request: false, thunder_coach: false });
  });

  it("changing the email means it must be verified again", async () => {
    await updateUser(deps(), director, "5550001", { ...edit, email: "new@example.com" });
    const u = await user("5550001");
    expect(u.email).toBe("new@example.com");
    expect(u.verified_email).toBe("pat@example.com");
  });

  it("you can't deactivate yourself, and editing yourself leaves your Director role alone", async () => {
    const me = { first: "Earl", last: "Epps", email: "", active: true, coach: false };
    expect(await updateUser(deps(), director, "9913694", me)).toEqual({ ok: true });
    expect(await user("9913694")).toMatchObject({ thunder_director: true });
    expect(await updateUser(deps(), director, "9913694", { ...me, active: false })).toEqual({
      ok: false,
      message: "You can't deactivate yourself.",
    });
    expect(await updateUser(deps(), director, "9913694", { ...me, coach: true })).toEqual({ ok: true });
  });

  it("checks names and email", async () => {
    expect(await updateUser(deps(), director, "5550001", { ...edit, first: "=HYPERLINK()" })).toMatchObject({ ok: false });
    expect(await updateUser(deps(), director, "5550001", { ...edit, email: "nope" })).toMatchObject({
      ok: false,
      message: "That email doesn't look right.",
    });
  });

  it("adds a user with the starter PIN; refuses a taken cell or matching last 7 digits", async () => {
    const r = await addUser(deps(), director, { first: "New", last: "Coach", cell: "(423) 555-9999", email: "", coach: true });
    expect(r).toEqual({ ok: true, coachId: "5559999" });
    expect(await user("5559999")).toMatchObject({ pin_hash: null, thunder_coach: true, email: null, updated_by: "Earl Epps" });
    expect(await addUser(deps(), director, { first: "A", last: "B", cell: "4235559999", email: "", coach: false })).toMatchObject(
      { ok: false, message: "New Coach already has that cell number." },
    );
    expect(await addUser(deps(), director, { first: "A", last: "B", cell: "6155559999", email: "", coach: false })).toMatchObject(
      { ok: false, message: expect.stringMatching(/same 7 digits as New Coach/) },
    );
  });

  it("deletes only where appropriate", async () => {
    expect(await deleteUser(deps(), director, "9913694")).toEqual({ ok: false, message: "You can't delete yourself." });
    expect(await deleteUser(deps(), director, "5550002")).toMatchObject({ ok: false, message: /Scenic City/ });
    const t = await db.pool.query<{ id: string }>(
      "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Test', 'Girls', '{4}', 4, 'REC', 'x') returning id",
    );
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'Manager', 'x')", [
      t.rows[0].id,
    ]);
    expect(await deleteUser(deps(), director, "5550001")).toMatchObject({ ok: false, message: /on a team/ });
    await db.pool.query("delete from team_staff");
    await db.pool.query(
      "insert into sessions (token_hash, coach_id, created_at, expires_at) values ('x', '5550001', now(), now() + interval '1 hour')",
    );
    expect(await deleteUser(deps(), director, "5550001")).toEqual({ ok: true });
    expect(await user("5550001")).toBeUndefined();
    expect((await db.pool.query("select count(*)::int n from sessions")).rows[0].n).toBe(0);
  });

  it("only the Director can manage users", async () => {
    expect(await updateUser(deps(), coach, "5550002", edit)).toMatchObject({ ok: false });
    expect(await addUser(deps(), coach, { first: "A", last: "B", cell: "4235558888", email: "", coach: true })).toMatchObject({
      ok: false,
    });
    expect(await deleteUser(deps(), coach, "5550002")).toMatchObject({ ok: false });
    expect(await denyRequest(deps(), coach, "5550001")).toMatchObject({ ok: false });
    expect(await user("5550001")).toMatchObject({ thunder_request: true });
  });

  it("only an Admin manages users: a Director with areas but not Admin is refused", async () => {
    const facilities = { ...director, thunderAreas: ["facilities" as const], isAdmin: false };
    expect(await updateUser(deps(), facilities, "5550001", edit)).toEqual({
      ok: false,
      message: "Only an Admin can manage users.",
    });
    expect(await updateUser(deps(), { ...facilities, isAdmin: true }, "5550001", edit)).toEqual({ ok: true });
  });

  it("approves a team staff sign-up onto the team they picked; Head/Asst Coaches get the Coach role; refuses a second head coach", async () => {
    const t = await db.pool.query<{ id: string }>(
      "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Test', 'Girls', '{4}', 4, 'REC', 'x') returning id::text",
    );
    await db.pool.query(
      "insert into join_reasons (coach_id, purpose, staff_role, team_id) values ('5550001', 'staff', 'AsstCoach', $1)",
      [t.rows[0].id],
    );
    expect(await approveJoin(deps(), coach, "5550001")).toMatchObject({ ok: false }); // not an Admin
    expect(await approveJoin(deps(), director, "5550001")).toEqual({
      ok: true,
      message: "Pat Test added to 4G Test as Asst Coach.",
    });
    expect(await user("5550001")).toMatchObject({ thunder_coach: true, thunder_request: false });
    const staff = await db.pool.query("select role, added_by from team_staff where coach_id = '5550001'");
    expect(staff.rows).toEqual([{ role: "AsstCoach", added_by: "Earl Epps" }]);
    expect((await db.pool.query("select count(*)::int n from join_reasons")).rows[0].n).toBe(0);

    // A typed-in team can't be placed automatically; a second head coach is refused.
    await db.pool.query(
      "insert into join_reasons (coach_id, purpose, staff_role, team_text) values ('5550002', 'staff', 'Manager', 'Somebody')",
    );
    expect(await approveJoin(deps(), director, "5550002")).toMatchObject({ ok: false, message: /isn't listed/ });
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '9913694', 'HeadCoach', 'x')", [
      t.rows[0].id,
    ]);
    await db.pool.query(
      "update join_reasons set staff_role = 'HeadCoach', team_id = $1, team_text = null where coach_id = '5550002'",
      [t.rows[0].id],
    );
    expect(await approveJoin(deps(), director, "5550002")).toMatchObject({ ok: false, message: /already has a head coach/ });
  });
});
