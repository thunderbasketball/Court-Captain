import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deletePlayerProgram, playerProgramFields, savePlayerProgram, seasonSources } from "./player-programs";
import { orgPrograms } from "./programs";
import { createEvent } from "./events";
import { addScrimmage } from "./scrimmages";
import { createTestDb } from "./testing/db";

const NOW = new Date("2026-11-11T17:00:00Z");
const al = { coachId: "5550001", firstName: "Al", lastName: "X" } as never;
const di = { coachId: "5550002", firstName: "Di", lastName: "X" } as never;

describe("player programs", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => NOW });
  let league = "";
  const base = { name: "Spring 2027", regOpens: "2027-01-05", regCloses: "", payOpens: "", payCloses: "", seasonFrom: "", startsOn: "2027-03-01", endsOn: "2027-05-15" };

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Al', 'X', '4235550001'), ('5550002', 'Di', 'X', '4235550002')`,
    );
    await db.pool.query("select set_role('5550001', 'thunder', 'Admin', true, 'test'), set_role('5550002', 'thunder', 'Director', true, 'test')");
    league = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter League', '2026-12-05', '2027-02-27', '2026-10-01', '2026-11-20', 'x', 'x') returning id::text`,
      )
    ).rows[0].id;
  });

  it("Admins (and Directors of Events) add and change a season; dates are checked", async () => {
    expect(await savePlayerProgram(deps(), di, "thunder", null, base)).toMatchObject({ ok: false }); // no Events area
    expect(await savePlayerProgram(deps(), al, "thunder", null, { ...base, name: " " })).toMatchObject({ ok: false });
    expect(await savePlayerProgram(deps(), al, "thunder", null, { ...base, payOpens: "2027-01-05" })).toMatchObject({ ok: false });
    expect(await savePlayerProgram(deps(), al, "thunder", null, { ...base, endsOn: "2027-02-01" })).toMatchObject({ ok: false });
    const r = await savePlayerProgram(deps(), al, "thunder", null, base);
    expect(r).toMatchObject({ ok: true });
    const id = (r as { id: string }).id;
    // Registration opens 60 days before the season starts (Mar 1 → Dec 31), whatever date is sent.
    expect(await playerProgramFields(db.pool, "thunder", id)).toMatchObject({ regOpens: "2026-12-31", regCloses: "" });
    expect(await savePlayerProgram(deps(), al, "thunder", null, base)).toMatchObject({ ok: false, message: expect.stringContaining("already") });

    // Season from the League instead, with payment dates.
    expect(
      await savePlayerProgram(deps(), al, "thunder", id, { ...base, seasonFrom: league, startsOn: "", endsOn: "", payOpens: "2027-01-05", payCloses: "2027-02-01" }),
    ).toEqual({ ok: true, id });
    // …registration then opens 60 days before the League starts (Dec 5 → Oct 6).
    expect(await playerProgramFields(db.pool, "thunder", id)).toMatchObject({ seasonFrom: league, startsOn: "", payCloses: "2027-02-01", regOpens: "2026-10-06" });
    expect((await orgPrograms(db.pool, "thunder", NOW))[0]).toMatchObject({ name: "Spring 2027", startsOn: "2026-12-05", seasonFrom: "Winter League" });
    expect(await playerProgramFields(db.pool, "east-ridge", id)).toBeNull(); // another organization's
    expect((await seasonSources(db.pool, NOW)).map((s) => s.name)).toEqual(["Winter League"]);
  });

  it("only an empty program can be deleted", async () => {
    const id = ((await savePlayerProgram(deps(), al, "thunder", null, base)) as { id: string }).id;
    await db.pool.query(
      `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw, imported_at, imported_by, program_id)
       values ('r1', 'r1', 'P', 'K', 'Boys', '5', 5, 'x', '{}', now(), 'x', $1)`,
      [id],
    );
    expect(await deletePlayerProgram(deps(), di, "thunder", id)).toMatchObject({ ok: false }); // not an Admin
    expect(await deletePlayerProgram(deps(), al, "thunder", id)).toMatchObject({ ok: false, message: expect.stringContaining("players") });
    await db.pool.query("delete from registrations");
    expect(await deletePlayerProgram(deps(), al, "thunder", id)).toEqual({ ok: true });
    expect(await playerProgramFields(db.pool, "thunder", id)).toBeNull();
  });

  it("a type and settings: a Season (Tryouts, Open Gyms, Scrimmages, grades, levels) or a Training Session or Course; they decide its Sessions and scrimmages", async () => {
    const earl = { coachId: "5550001", firstName: "Al", lastName: "X", isDirector: true } as never; // Thunder Admin (events area)
    await db.pool.query("insert into event_types (name, created_by) values ('Open Gym', 'x'), ('Tryouts', 'x'), ('Training', 'x') on conflict do nothing");
    // A Season for 3rd–4th REC, no Tryouts.
    const season = await savePlayerProgram(deps(), al, "thunder", null, { ...base, kind: "Season", tryouts: false, openGyms: true, grades: ["3", "4"], levels: ["REC"], genders: ["Boys"] });
    expect(season).toMatchObject({ ok: true });
    const sid = (season as { id: string }).id;
    expect(await playerProgramFields(db.pool, "thunder", sid)).toMatchObject({ kind: "Season", tryouts: false, openGyms: true, grades: ["3", "4"], genders: ["Boys"], boysGrades: ["3", "4"], girlsGrades: [] });
    expect((await orgPrograms(db.pool, "thunder", NOW)).find((p) => p.id === sid)?.settings).toEqual({
      kind: "Season", tryouts: false, openGyms: true, scrimmages: true, sessions: null, grades: ["3", "4"], levels: ["REC", "COMP"], genders: ["Boys"],
      boysGrades: ["3", "4"], girlsGrades: [],
    });
    // Each gender its own grades: Boys K–2 and Girls 3–4 (a gender picked needs grades).
    expect(await savePlayerProgram(deps(), al, "thunder", null, { ...base, name: "Mixed", genders: ["Boys", "Girls"], boysGrades: ["K", "1", "2"], girlsGrades: [] })).toMatchObject({
      ok: false,
      message: "Pick the Girls grades.",
    });
    const mixed = (await savePlayerProgram(deps(), al, "thunder", null, { ...base, name: "Mixed", genders: ["Boys", "Girls"], boysGrades: ["K", "1", "2"], girlsGrades: ["3", "4"] })) as { id: string };
    expect(await playerProgramFields(db.pool, "thunder", mixed.id)).toMatchObject({ grades: ["K", "1", "2", "3", "4"], boysGrades: ["K", "1", "2"], girlsGrades: ["3", "4"] });
    expect(await savePlayerProgram(deps(), al, "thunder", null, { ...base, name: "No gender", genders: [] })).toMatchObject({ ok: false });
    expect(await savePlayerProgram(deps(), al, "thunder", null, { ...base, name: "None", grades: [] })).toMatchObject({ ok: false });
    const session = { kind: "Open Gym", gender: "Boys", date: "2027-03-10", time: "18:00", location: "Gym", notes: "", grades: ["3"], staff: [], programId: sid };
    expect(await createEvent(deps(), earl, session)).toMatchObject({ ok: true });
    expect(await createEvent(deps(), earl, { ...session, kind: "Tryouts" })).toMatchObject({ ok: false, message: expect.stringContaining("doesn't have") });
    expect(await createEvent(deps(), earl, { ...session, grades: ["5"] })).toMatchObject({ ok: false, message: expect.stringContaining("only") });
    expect(await createEvent(deps(), earl, { ...session, gender: "Girls" })).toMatchObject({ ok: false, message: expect.stringContaining("Boys only") });
    // Scrimmages only for its grades and levels.
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('3B A', 'Boys', '{3}', 3, 'REC', 'x'), ('3B B', 'Boys', '{3}', 3, 'COMP', 'x'), ('3G C', 'Girls', '{3}', 3, 'REC', 'x') returning id::text`,
    );
    const [a, b, c] = t.rows.map((r) => r.id);
    const scrim = { date: "2027-03-12", time: "18:00", gymId: "", location: "Red Bank MS" };
    expect(await addScrimmage(deps(), earl, "thunder", sid, { home: a, away: b, ...scrim })).toMatchObject({ ok: true });
    expect(await addScrimmage(deps(), earl, "thunder", sid, { home: a, away: c, ...scrim, time: "19:00" })).toMatchObject({ ok: false, message: expect.stringContaining("genders and their grades") });
    // A Training Course (its number of sessions): Training sessions only, and no scrimmages.
    expect(await savePlayerProgram(deps(), al, "thunder", null, { ...base, name: "Skills Course", kind: "Course", grades: ["3"], genders: ["Boys"] })).toMatchObject({
      ok: false,
      message: expect.stringContaining("How many sessions"),
    });
    const clinic = (await savePlayerProgram(deps(), al, "thunder", null, { ...base, name: "Skills Course", kind: "Course", sessions: "6", grades: ["3"], genders: ["Boys"] })) as { id: string };
    expect(await playerProgramFields(db.pool, "thunder", clinic.id)).toMatchObject({ kind: "Course", sessions: "6", tryouts: false, openGyms: false, scrimmages: false });
    expect(await createEvent(deps(), earl, { ...session, programId: clinic.id })).toMatchObject({ ok: false });
    expect(await createEvent(deps(), earl, { ...session, kind: "Training", programId: clinic.id })).toMatchObject({ ok: true });
    expect(await addScrimmage(deps(), earl, "thunder", clinic.id, { home: a, away: b, ...scrim, time: "20:00" })).toMatchObject({ ok: false, message: expect.stringContaining("doesn't have scrimmages") });
    // A Season without Scrimmages has none either.
    await savePlayerProgram(deps(), al, "thunder", sid, { ...base, kind: "Season", scrimmages: false, grades: ["3", "4"], levels: ["REC"], genders: ["Boys"] });
    expect(await addScrimmage(deps(), earl, "thunder", sid, { home: a, away: b, ...scrim, time: "21:00" })).toMatchObject({ ok: false });
  });

  it("with Tryouts: registration opens the day the program is added (kept on changes); each tryout's closes on its own day (walk-ins)", async () => {
    const earl = { coachId: "5550001", firstName: "Al", lastName: "X", isDirector: true } as never;
    await db.pool.query("insert into event_types (name, created_by) values ('Tryouts', 'x') on conflict do nothing");
    const season = { ...base, kind: "Season", tryouts: true, grades: ["5", "6"] };
    // Added without a date: it opens today (Nov 11, 2026), and stays so when the program is changed later.
    const r = (await savePlayerProgram(deps(), al, "thunder", null, season)) as { id: string };
    expect(await playerProgramFields(db.pool, "thunder", r.id)).toMatchObject({ tryoutRegOpens: "2026-11-11" });
    const later = { pool: db.pool, now: () => new Date("2026-12-01T17:00:00Z") };
    expect(await savePlayerProgram(later, al, "thunder", r.id, { ...season, name: "Spring 2027 b" })).toEqual({ ok: true, id: r.id });
    expect(await playerProgramFields(db.pool, "thunder", r.id)).toMatchObject({ tryoutRegOpens: "2026-11-11" });
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...season, tryoutRegOpens: "02/01" })).toMatchObject({ ok: false });
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...season, tryoutRegOpens: "2027-02-01" })).toEqual({ ok: true, id: r.id });
    const one = { kind: "Tryouts", gender: "Girls", grades: ["5", "6"], time: "18:00", location: "Gym", notes: "", staff: [], programId: r.id };
    const girls = (await createEvent(deps(), earl, { ...one, date: "2027-02-25" })) as { id: string };
    const boys = (await createEvent(deps(), earl, { ...one, gender: "Boys", date: "2027-02-27" })) as { id: string };
    const signup = async (id: string) =>
      (await db.pool.query("select to_char(signup_opens, 'YYYY-MM-DD') as o, to_char(signup_closes, 'YYYY-MM-DD') as c from events where id = $1", [id])).rows[0];
    expect(await signup(girls.id)).toEqual({ o: "2027-02-01", c: "2027-02-25" });
    expect(await signup(boys.id)).toEqual({ o: "2027-02-01", c: "2027-02-27" });
    expect(await createEvent(deps(), earl, { ...one, gender: "Coed", date: "2027-02-27" })).toMatchObject({ ok: false, message: expect.stringContaining("no Coed") });
  });

  it("fee levels: how many (1 by default), each its fee and its Boys and Girls grades; they make the program's genders and grades", async () => {
    const two = [
      { name: "Elementary", fee: "150", endsOn: "2027-05-15", boysGrades: ["K", "1", "2", "3", "4", "5"], girlsGrades: [] },
      { name: "", fee: "$175.50", endsOn: "2027-05-15", boysGrades: ["6", "7", "8"], girlsGrades: ["3", "4", "5", "6", "7", "8"] },
    ];
    const r = (await savePlayerProgram(deps(), al, "thunder", null, { ...base, feeLevels: two })) as { id: string };
    expect(await playerProgramFields(db.pool, "thunder", r.id)).toMatchObject({
      genders: ["Boys", "Girls"],
      boysGrades: ["K", "1", "2", "3", "4", "5", "6", "7", "8"],
      girlsGrades: ["3", "4", "5", "6", "7", "8"],
      feeLevels: [
        { name: "Elementary", fee: "150.00", boysGrades: ["K", "1", "2", "3", "4", "5"], girlsGrades: [] },
        { name: "Fee 2", fee: "175.50", boysGrades: ["6", "7", "8"], girlsGrades: ["3", "4", "5", "6", "7", "8"] },
      ],
    });
    // The same grades in several fees (Local, Regional, National): fine.
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...base, feeLevels: [two[0], { ...two[1], boysGrades: ["5"] }] })).toEqual({ ok: true, id: r.id });
    // Each fee its own season end date (required when the dates are typed in): registration for it closes then; the
    // season ends on the latest; bad or before the season starts: refused.
    const ends = [{ ...two[0], name: "Local", endsOn: "" }, { ...two[1], name: "National", endsOn: "2027-07-31" }];
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...base, feeLevels: ends })).toEqual({ ok: false, message: "Local: give its season end date." });
    ends[0].endsOn = "2027-05-15";
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...base, endsOn: "", feeLevels: ends })).toEqual({ ok: true, id: r.id });
    expect(await playerProgramFields(db.pool, "thunder", r.id)).toMatchObject({
      endsOn: "2027-07-31",
      regOpens: "2026-12-31",
      regCloses: "2027-07-31",
      feeLevels: [{ name: "Local", endsOn: "2027-05-15" }, { name: "National", endsOn: "2027-07-31" }],
    });
    // From a League: a fee's blank end is the League's.
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...base, seasonFrom: league, feeLevels: [{ ...ends[0], endsOn: "" }] })).toEqual({ ok: true, id: r.id });
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...base, feeLevels: [{ ...ends[1], endsOn: "07/31" }] })).toMatchObject({ ok: false });
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...base, feeLevels: [{ ...ends[1], endsOn: "2000-01-01" }] })).toMatchObject({
      ok: false,
      message: "National: its season can't end before it starts.",
    });
    // A level with no grades, or a bad fee: refused.
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...base, feeLevels: [{ fee: "", boysGrades: [], girlsGrades: [] }] })).toMatchObject({ ok: false });
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...base, feeLevels: [{ ...two[0], fee: "abc" }] })).toMatchObject({ ok: false });
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...base, feeLevels: [{ ...two[0], name: "=HYPERLINK()" }] })).toMatchObject({ ok: false });
    // Down to one level (Girls only, no fee yet): the program follows.
    expect(await savePlayerProgram(deps(), al, "thunder", r.id, { ...base, feeLevels: [{ fee: "", endsOn: "2027-05-15", boysGrades: [], girlsGrades: ["5"] }] })).toEqual({ ok: true, id: r.id });
    expect(await playerProgramFields(db.pool, "thunder", r.id)).toMatchObject({ genders: ["Girls"], boysGrades: [], girlsGrades: ["5"], feeLevels: [{ fee: "" }] });
  });
});
