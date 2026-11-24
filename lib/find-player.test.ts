import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "./auth/service";
import { CODE_SENT, findComplete, findStart } from "./find-player";
import { createTestDb, testClock, testMailer } from "./testing/db";

describe("Find my player's team", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let mail: ReturnType<typeof testMailer>;
  let deps: Deps;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  beforeEach(async () => {
    await db.reset();
    mail = testMailer();
    deps = { pool: db.pool, sendEmail: mail.sendEmail, now: testClock("2026-11-20T15:00:00Z").now };
    const reg = (id: string, first: string, grade: string, p1: string, e1: string | null, p2: string | null, e2: string | null) =>
      db.pool.query(
        `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program,
                                    parent1_cell, parent1_email, parent2_cell, parent2_email, raw, imported_at, imported_by)
         values ($1, $1, $2, 'Lee', 'Boys', $3, $4, 'x', $5, $6, $7, $8, '{}', now(), 'x')`,
        [id, first, grade, Number(grade), p1, e1, p2, e2],
      );
    await reg("r1", "Sam", "5", "4235550001", "mom@example.com", "4235550002", "dad@example.com");
    await reg("r2", "Ann", "3", "4235550001", "mom@example.com", null, null);
    await reg("r3", "Cy", "4", "4235550009", null, null, null); // no email on it
    const team = (
      await db.pool.query<{ id: string }>(
        "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('5B Lopez', 'Boys', '{5}', 5, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       values ($1, 'r1', 'Sam', 'Lee', 'Boys', '5', 5, 'x', now())`,
      [team],
    );
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell, email, active) values ('5550077', 'Lu', 'Lopez', '4235550077', 'lu@example.com', true)",
    );
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550077', 'HeadCoach', 'x')", [team]);
  });

  it("emails a code to that parent's email, then shows their players and teams", async () => {
    expect(await findStart(deps, "(423) 555-0002")).toEqual({ step: "code", message: CODE_SENT });
    expect(mail.sent.map((m) => m.to)).toEqual(["dad@example.com"]);
    const s = await findComplete(deps, "4235550002", mail.lastCode());
    expect(s.step).toBe("found");
    if (s.step !== "found") return;
    expect(s.players).toHaveLength(1);
    expect(s.players[0]).toMatchObject({ name: "Sam Lee", grade: "Boys 5th", org: "Thunder" });
    expect(s.players[0].team).toMatchObject({ name: "5B Lopez", staff: [{ role: "Head Coach", name: "Lu Lopez", cell: "4235550077" }] });
  });

  it("a parent with two players sees both; one not on a team says so", async () => {
    await findStart(deps, "4235550001");
    expect(mail.sent[0].to).toBe("mom@example.com");
    const s = await findComplete(deps, "4235550001", mail.lastCode());
    if (s.step !== "found") throw new Error(s.step);
    expect(s.players.map((p) => [p.name, p.team?.name ?? null])).toEqual([
      ["Ann Lee", null],
      ["Sam Lee", "5B Lopez"],
    ]);
  });

  it("the same answer for an unknown number or one with no email, and no email is sent", async () => {
    expect(await findStart(deps, "4235559999")).toEqual({ step: "code", message: CODE_SENT });
    expect(await findStart(deps, "4235550009")).toEqual({ step: "code", message: CODE_SENT });
    expect(mail.sent).toHaveLength(0);
    const s = await findComplete(deps, "4235559999", "123456");
    expect(s.step).toBe("error"); // nothing to show
  });

  it("wrong codes are counted; the code works once", async () => {
    await findStart(deps, "4235550001");
    const code = mail.lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await findComplete(deps, "4235550001", wrong)).toMatchObject({ step: "error", message: expect.stringMatching(/Wrong code/) });
    expect((await findComplete(deps, "4235550001", code)).step).toBe("found");
    expect((await findComplete(deps, "4235550001", code)).step).toBe("error");
  });

  it("refuses a bad cell", async () => {
    expect(await findStart(deps, "12")).toEqual({ step: "error", message: "Enter your 10-digit cell number." });
  });
});
