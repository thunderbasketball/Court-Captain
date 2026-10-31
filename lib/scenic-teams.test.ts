import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import {
  GRADE_CHOICES,
  createScenicTeam,
  deleteScenicTeam,
  gradeLabel,
  listScenicTeams,
  parseGrade,
  updateScenicTeam,
} from "./scenic-teams";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const dee = person("9913694", "Dee"); // Scenic City Director of Teams
const pat = person("5550001", "Pat"); // Partner, contact for Baylor
const sam = person("5550002", "Sam"); // Solo
const fay = person("5550004", "Fay"); // Scenic City Director of Facilities only

describe("Scenic City teams", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const now = new Date("2026-11-02T15:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  let baylor = "";
  let hostsOnly = "";
  const team = (o: Partial<Record<string, string>> = {}) => ({
    name: "Baylor 5th Boys",
    gender: "Boys",
    level: "REC",
    grade: "5",
    coachFirst: "Cy",
    coachLast: "Coach",
    coachCell: "(423) 555-0003",
    ...o,
  });

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('9913694', 'Dee', 'X', '4239913694'), ('5550001', 'Pat', 'X', '4235550001'), ('5550002', 'Sam', 'X', '4235550002'),
         ('5550004', 'Fay', 'X', '4235550004')`,
    );
    await grant(
      db.pool,
      "9913694 scenic-city Director",
      "5550004 scenic-city Director",
      "5550001 scenic-city Partner",
      "5550002 scenic-city Solo",
    );
    await db.pool.query(
      `insert into director_areas (coach_id, org, area, granted_by) values
         ('9913694', 'scenic-city', 'teams', 'test'), ('5550004', 'scenic-city', 'facilities', 'test')`,
    );
    const p = await db.pool.query<{ id: string }>(
      `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values
         ('Baylor School', 'School', false, true, true, 'test'), ('Gym Host', 'Organization', true, false, true, 'test')
       returning id::text`,
    );
    [baylor, hostsOnly] = p.rows.map((r) => r.id);
    await db.pool.query("insert into partner_contacts (partner_id, coach_id, added_by) values ($1, '5550001', 'test')", [baylor]);
  });

  it("grades: one grade or two in a row, listed with the higher grade", () => {
    expect(GRADE_CHOICES.slice(0, 4).map((g) => g.label)).toEqual(["K", "K/1st", "1st", "1st/2nd"]);
    expect(GRADE_CHOICES.at(-1)).toEqual({ value: "12", label: "12th" });
    expect(parseGrade("3-4")).toEqual({ low: 3, grade: 4 });
    expect(parseGrade("4")).toEqual({ low: 4, grade: 4 });
    for (const bad of ["3-5", "4-3", "13", "12-13", "x", 4]) expect(parseGrade(bad)).toBeNull();
    expect(gradeLabel(3, 4)).toBe("3rd/4th");
    expect(gradeLabel(0, 0)).toBe("K");
  });

  it("a partner's contact adds its teams; the coach's cell becomes their login with the Coach role", async () => {
    const r = await createScenicTeam(deps(), pat, { ...team(), for: baylor });
    expect(r).toMatchObject({ ok: true, newLogin: true });
    const coach = await db.pool.query(
      "select first_name, cell, pin_hash, email, has_role(coach_id, 'scenic-city', 'Coach') as coach from users where coach_id = '5550003'",
    );
    expect(coach.rows[0]).toEqual({ first_name: "Cy", cell: "4235550003", pin_hash: null, email: null, coach: true });

    const list = await listScenicTeams(deps(), pat, "Partner");
    expect(list!.teams).toMatchObject([
      {
        name: "Baylor 5th Boys",
        gradeLabel: "5th",
        partnerName: "Baylor School",
        coachLast: "Coach",
        createdBy: "Pat X",
        canEdit: true,
      },
    ]);
    expect(list!.addFor).toEqual([{ value: baylor, label: "Baylor School" }]);

    // Same name at the same partner: refused (any case). Not for a partner they aren't a contact of, or one that only hosts.
    expect(await createScenicTeam(deps(), pat, { ...team({ name: "baylor 5th boys" }), for: baylor })).toMatchObject({
      ok: false,
    });
    expect(await createScenicTeam(deps(), pat, { ...team(), for: hostsOnly })).toEqual({
      ok: false,
      message: "That partner doesn't register teams.",
    });
    expect(await createScenicTeam(deps(), sam, { ...team({ name: "Other" }), for: baylor })).toMatchObject({ ok: false });
  });

  it("Solo coaches add and see their own teams; Directors of Teams see every team, Boys then Girls, by grade", async () => {
    await createScenicTeam(deps(), pat, { ...team(), for: baylor });
    expect(
      await createScenicTeam(deps(), sam, {
        ...team({
          name: "Sam's Girls",
          gender: "Girls",
          grade: "3-4",
          coachCell: "4235550002",
          coachFirst: "Sam",
          coachLast: "X",
        }),
        for: "solo",
      }),
    ).toMatchObject({
      ok: true,
      newLogin: false, // Sam coaches it himself
    });
    await createScenicTeam(deps(), sam, {
      ...team({ name: "Sam 4th", grade: "4", coachCell: "4235550002", coachFirst: "Sam", coachLast: "X" }),
      for: "solo",
    });
    expect(await createScenicTeam(deps(), pat, { ...team({ name: "Nope" }), for: "solo" })).toMatchObject({ ok: false });

    const solo = await listScenicTeams(deps(), sam, "Solo");
    expect(solo!.teams.map((t) => `${t.name}:${t.gradeLabel}:${t.ownerName}`)).toEqual([
      "Sam 4th:4th:Sam X",
      "Sam's Girls:3rd/4th:Sam X",
    ]);
    expect(solo!.addFor).toEqual([{ value: "solo", label: "My teams (Solo)" }]);
    expect((await listScenicTeams(deps(), pat, "Partner"))!.teams.map((t) => t.name)).toEqual(["Baylor 5th Boys"]);

    const all = await listScenicTeams(deps(), dee, "Director");
    expect(all!.teams.map((t) => t.name)).toEqual(["Sam 4th", "Baylor 5th Boys", "Sam's Girls"]);
    expect(all!.teams.every((t) => t.canEdit)).toBe(true);
    expect(all!.addFor.map((p) => p.label)).toEqual(["Baylor School"]);
    expect(await listScenicTeams(deps(), fay, "Director")).toBeNull(); // Facilities only
    expect(await listScenicTeams(deps(), pat, "Solo")).toBeNull(); // not their role
  });

  it("coaches see the teams they coach but can't change them; edits and deletes are recorded and checked", async () => {
    const { id } = (await createScenicTeam(deps(), pat, { ...team(), for: baylor })) as { id: string };
    const cy = person("5550003", "Cy");
    const mine = await listScenicTeams(deps(), cy, "Coach");
    expect(mine!.teams).toMatchObject([{ name: "Baylor 5th Boys", canEdit: false }]);
    expect(mine!.addFor).toEqual([]);
    expect(await updateScenicTeam(deps(), cy, id, team({ name: "Mine now" }))).toEqual({
      ok: false,
      message: "You can't change this team.",
    });
    expect(await deleteScenicTeam(deps(), sam, id)).toEqual({ ok: false, message: "You can't change this team." });

    expect(
      await updateScenicTeam(deps(), dee, id, team({ grade: "4-5", coachCell: "4235550002", coachFirst: "Sam", coachLast: "X" })),
    ).toEqual({ ok: true, newLogin: false });
    const t = await db.pool.query("select grade_low, grade, coach_id, updated_by, created_by from scenic_teams where id = $1", [
      id,
    ]);
    expect(t.rows[0]).toEqual({ grade_low: 4, grade: 5, coach_id: "5550002", updated_by: "Dee X", created_by: "Pat X" });

    expect(await deleteScenicTeam(deps(), pat, id)).toEqual({ ok: true });
    expect((await listScenicTeams(deps(), dee, "Director"))!.teams).toEqual([]);
  });

  it("checks every field on the server (no formulas, real cell, a listed grade)", async () => {
    expect(await createScenicTeam(deps(), pat, { ...team({ name: "=HYPERLINK(1)" }), for: baylor })).toMatchObject({ ok: false });
    expect(await createScenicTeam(deps(), pat, { ...team({ coachCell: "555" }), for: baylor })).toMatchObject({
      ok: false,
      message: /10-digit/,
    });
    expect(await createScenicTeam(deps(), pat, { ...team({ grade: "3-5" }), for: baylor })).toEqual({
      ok: false,
      message: "Pick a grade.",
    });
    expect(await createScenicTeam(deps(), pat, { ...team({ gender: "Coed" }), for: baylor })).toEqual({
      ok: false,
      message: "Pick Boys or Girls.",
    });
    expect(await createScenicTeam(deps(), pat, { ...team({ level: "ELITE" }), for: baylor })).toEqual({ ok: false, message: "Pick COMP or REC." });
    expect(await createScenicTeam(deps(), pat, { ...team({ coachFirst: "@x" }), for: baylor })).toMatchObject({ ok: false });
    expect(await createScenicTeam(deps(), pat, { ...team(), for: "nobody" })).toEqual({
      ok: false,
      message: "Pick who the team is for.",
    });
  });
});
