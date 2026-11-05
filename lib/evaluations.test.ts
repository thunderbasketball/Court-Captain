import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { evaluationCounts, listEvaluations, playerEvaluations, saveEvaluation } from "./evaluations";
import { importEvaluations, parseEvaluationsTab } from "./evaluations-import";
import { addPlayers } from "./rosters";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string, isDirector = false): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector,
  isCoach: true,
  requestPending: false,
  hasThunderRole: true,
});
const dir = person("9913694", "Dee", true);
const hc = person("5550001", "Hal"); // Head Coach, 4G A
const ac = person("5550002", "Amy"); // Assistant Coach, 4G A
const tm = person("5550003", "Tim"); // Manager, 4G A
const other = person("5550004", "Oz"); // Head Coach, 4G B

describe("evaluations", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  let now = new Date("2026-11-10T12:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  let A = "";
  let B = "";

  beforeEach(async () => {
    await db.reset();
    now = new Date("2026-11-10T12:00:00Z");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('5550001', 'Hal', 'X', '4235550001'), ('5550002', 'Amy', 'X', '4235550002'),
         ('5550003', 'Tim', 'X', '4235550003'), ('5550004', 'Oz', 'X', '4235550004')`,
    );
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values
         ('4G A', 'Girls', '{4}', 4, 'REC', 'x'), ('4G B', 'Girls', '{4}', 4, 'REC', 'x') returning id::text`,
    );
    [A, B] = t.rows.map((r) => r.id);
    // Dee is a Thunder Admin: Owners and Admins see who saved a card; coaches don't.
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Dee', 'X', '4235559999') on conflict do nothing",
    );
    await grant(db.pool, "9913694 thunder Director", "9913694 thunder Admin");
    await db.pool.query(
      `insert into team_staff (team_id, coach_id, role, added_by) values
         ($1, '5550001', 'HeadCoach', 'x'), ($1, '5550002', 'AsstCoach', 'x'), ($1, '5550003', 'Manager', 'x'), ($2, '5550004', 'HeadCoach', 'x')`,
      [A, B],
    );
    for (const [id, first, last, gender, grade] of [
      ["r1", "Ava", "Zed", "Girls", "4"],
      ["r2", "Bea", "Young", "Girls", "3"], // one grade below: eligible
      ["r3", "Cy", "Xu", "Girls", "2"], // two below: not
      ["r4", "Dan", "Wu", "Boys", "4"], // boy: not
      ["r5", "Eve", "Vo", "Girls", "4"],
    ]) {
      await db.pool.query(
        `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw, imported_at, imported_by)
         values ($1, $1, $2, $3, $4, $5, $6, 'x', '{}', now(), 'x')`,
        [id, first, last, gender, grade, Number(grade)],
      );
    }
  });

  const names = async (u: SessionUser, team: string) => (await listEvaluations(deps(), u, team))?.map((c) => c.firstName);

  it("coaches see their team's grade and one below, same gender; top grade first", async () => {
    expect(await names(hc, A)).toEqual(["Eve", "Ava", "Bea"]);
    expect(await names(ac, A)).toEqual(["Eve", "Ava", "Bea"]);
    expect(await names(dir, A)).toEqual(["Eve", "Ava", "Bea"]);
    expect(await listEvaluations(deps(), tm, A)).toBeNull(); // a Manager doesn't evaluate
    expect(await listEvaluations(deps(), other, A)).toBeNull(); // another team's coach
    expect(await listEvaluations(deps(), hc, "1; drop table teams")).toBeNull();
  });

  it("saves only the changed fields and records who; each team sees only its own cards", async () => {
    expect(await saveEvaluation(deps(), hc, A, "r1", { position: "Guard", score: 4 })).toMatchObject({
      ok: true,
      updatedBy: null,
    });
    now = new Date("2026-11-10T13:00:00Z");
    expect(await saveEvaluation(deps(), ac, A, "r1", { speed: "Fast", notes: "  Great hands  " })).toMatchObject({
      ok: true,
      updatedBy: null, // a coach doesn't see who saved
    });
    const card = (await listEvaluations(deps(), hc, A))?.find((c) => c.registrantId === "r1");
    expect(card).toMatchObject({
      position: "Guard",
      score: 4,
      speed: "Fast",
      height: null,
      notes: "Great hands",
      updatedBy: null,
    });
    expect(card?.updatedAt).toEqual(now);
    // An Admin sees who saved it (it's always recorded).
    expect((await listEvaluations(deps(), dir, A))?.find((c) => c.registrantId === "r1")).toMatchObject({ updatedBy: "Amy X" });

    await saveEvaluation(deps(), other, B, "r1", { score: 2 });
    expect((await listEvaluations(deps(), other, B))?.find((c) => c.registrantId === "r1")).toMatchObject({
      score: 2,
      position: null,
    });
    expect(await saveEvaluation(deps(), other, A, "r1", { score: 1 })).toEqual({
      ok: false,
      message: "Only this team's coaches can evaluate players.",
    });
    expect(await saveEvaluation(deps(), tm, A, "r1", { score: 1 })).toMatchObject({ ok: false });
    expect(await evaluationCounts(deps(), A)).toEqual({ eligible: 3, evaluated: 1, interested: 0 });
  });

  it("Players page: the Director sees one player's card for each team they can play for, their own team first", async () => {
    const teams = async (id: string) => (await playerEvaluations(deps(), dir, id))?.map((x) => x.teamName);
    expect(await teams("r2")).toEqual(["4G A", "4G B"]); // a 3rd grader can play up for the 4th grade teams
    expect(await teams("r3")).toEqual([]); // two grades below: none
    await saveEvaluation(deps(), dir, B, "r1", { score: 5 });
    await addPlayers(deps(), dir, B, ["r1"]);
    const r1 = await playerEvaluations(deps(), dir, "r1");
    expect(r1?.map((x) => x.teamName)).toEqual(["4G B", "4G A"]); // rostered on B: B first
    expect(r1?.[0].card).toMatchObject({ score: 5, updatedBy: "Dee X", rosteredOn: ["4G B"] });
    expect(r1?.[1].card).toMatchObject({ score: null, updatedBy: null });
    expect(await playerEvaluations(deps(), hc, "r1")).toBeNull(); // Directors only
  });

  it("checks every value on the server", async () => {
    for (const bad of [
      { position: "Center" },
      { score: 6 },
      { score: "5" },
      { interested: "yes" },
      { notes: "x".repeat(1001) },
      { rank: 1 },
      {},
    ])
      expect(await saveEvaluation(deps(), hc, A, "r1", bad)).toMatchObject({ ok: false });
    expect(await saveEvaluation(deps(), hc, A, "r3", { score: 3 })).toEqual({
      ok: false,
      message: "That player isn't eligible for this team.",
    });
    expect(await saveEvaluation(deps(), hc, A, "r4", { score: 3 })).toMatchObject({ ok: false });
  });

  it("Interested shows as a pill to every team; clearing everything removes the card", async () => {
    await saveEvaluation(deps(), hc, A, "r5", { interested: true });
    await saveEvaluation(deps(), other, B, "r5", { interested: true, score: 5 });
    await addPlayers(deps(), dir, B, ["r5"]);
    expect((await listEvaluations(deps(), hc, A))?.find((c) => c.registrantId === "r5")).toMatchObject({
      interested: true,
      score: null, // 4G B's score stays with 4G B
      interestedTeams: ["4G A", "4G B"],
      rosteredOn: ["4G B"],
    });
    expect(await saveEvaluation(deps(), hc, A, "r5", { interested: false })).toEqual({
      ok: true,
      updatedBy: null,
      updatedAt: null,
    });
    expect((await db.pool.query("select 1 from evaluations where team_id = $1", [A])).rows).toEqual([]);
  });

  it("keeps a team's card when the player leaves registrations", async () => {
    await saveEvaluation(deps(), hc, A, "r2", { score: 3 });
    await db.pool.query("delete from registrations where registrant_id = 'r2'");
    expect((await listEvaluations(deps(), hc, A))?.find((c) => c.registrantId === "r2")).toMatchObject({
      score: 3,
      registered: false,
    });
    expect(await saveEvaluation(deps(), hc, A, "r2", { score: 4 })).toMatchObject({ ok: true });
  });

  it("imports the Sheet's Evaluations tab once; a dry run changes nothing", async () => {
    const parsed = parseEvaluationsTab([
      [
        "Player",
        "Grade",
        "Gender",
        "Team",
        "Coach",
        "Position",
        "Height",
        "Speed",
        "EvaluationScore",
        "EvaluationText",
        "Pickup",
      ],
      ["Ava Zed", "4th", "Girls", "4G A", "Hal X", "guard", "Average", "Fast", "5", "Lefty", "TRUE"],
      ["Bea Young", "3rd", "Girls", "4G A", "Hal X", "Point", "", "", "9", "", "FALSE"],
      ["Nobody Here", "4th", "Girls", "4G A", "Hal X", "", "", "", "", "", ""],
      ["Ava Zed", "4th", "Girls", "9Z None", "Hal X", "", "", "", "", "", ""],
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings.map((w) => w.row)).toEqual([3, 3]); // Point isn't a position; 9 isn't 1–5
    const opts = { now, by: "Sheet import" };
    expect((await importEvaluations(db.pool, parsed.items, { ...opts, dryRun: true })).map((r) => r.status)).toEqual([
      "added",
      "added",
      "noPlayer",
      "noTeam",
    ]);
    expect((await db.pool.query("select 1 from evaluations")).rows).toEqual([]);
    await importEvaluations(db.pool, parsed.items, { ...opts, dryRun: false });
    expect((await listEvaluations(deps(), hc, A))?.find((c) => c.registrantId === "r1")).toMatchObject({
      position: "Guard",
      height: "Average",
      speed: "Fast",
      score: 5,
      notes: "Lefty",
      interested: true,
    });
    expect((await listEvaluations(deps(), dir, A))?.find((c) => c.registrantId === "r1")).toMatchObject({ updatedBy: "Hal X" });
    expect((await importEvaluations(db.pool, parsed.items, { ...opts, dryRun: false }))[0].status).toBe("already");
  });
});
