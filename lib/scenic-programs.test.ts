import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";

const ALL = { allSeason: true, days: [] }; // register for ALL Season
import {
  addDivision,
  addPool,
  copyDivisions,
  deleteProgram,
  getProgram,
  listPrograms,
  moveTeam,
  registerTeam,
  removeDivision,
  removePool,
  saveProgram,
  saveProgramDates,
  setTeamOff,
  setPaid,
  withdrawTeam,
} from "./scenic-programs";
import { listGameDays } from "./scenic-partners";
import { createScenicTeam } from "./scenic-teams";
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
const dee = person("9913694", "Dee"); // Scenic City Director of Programs
const pat = person("5550001", "Pat"); // Partner, contact for Baylor
const sam = person("5550002", "Sam"); // Solo
const fay = person("5550004", "Fay"); // Director of Facilities only

describe("Scenic City programs", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  let now = new Date("2026-11-02T15:00:00Z"); // Mon Nov 2, Eastern
  const deps = () => ({ pool: db.pool, now: () => now });
  let baylor = "";
  const league = (o: Record<string, unknown> = {}) => ({
    kind: "League",
    name: "Winter League 2027",
    startsOn: "2027-01-09",
    endsOn: "2027-03-06",
    regOpens: "2026-11-01",
    regCloses: "2026-12-15",
    fee: "$150",
    ...o,
  });
  const newLeague = async (o: Record<string, unknown> = {}) =>
    ((await saveProgram(deps(), dee, null, league(o))) as { id: string }).id;
  const team = async (who: SessionUser, forWhom: string, name: string, gender: string, grade: string, level = "REC") =>
    (
      (await createScenicTeam(deps(), who, {
        for: forWhom,
        name,
        gender,
        level,
        grade,
        coachFirst: "Cy",
        coachLast: "Coach",
        coachCell: "4235550003",
      })) as { id: string }
    ).id;
  const div = (pid: string, gender: string, from: number, to: number, levels: string[]) =>
    addDivision(deps(), dee, pid, { gender, from, to, levels });

  beforeEach(async () => {
    now = new Date("2026-11-02T15:00:00Z");
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
         ('9913694', 'scenic-city', 'programs', 'test'), ('5550004', 'scenic-city', 'facilities', 'test')`,
    );
    const p = await db.pool.query<{ id: string }>(
      `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values ('Baylor School', 'School', false, true, true, 'test')
       returning id::text`,
    );
    baylor = p.rows[0].id;
    await db.pool.query("insert into partner_contacts (partner_id, coach_id, added_by) values ($1, '5550001', 'test')", [baylor]);
  });

  it("Directors of Programs create programs; everyone in Scenic City sees them; others can't create", async () => {
    expect(await saveProgram(deps(), fay, null, league())).toEqual({
      ok: false,
      message: "Only a Scenic City Director of Programs can do that.",
    });
    expect(await saveProgram(deps(), pat, null, league())).toMatchObject({ ok: false });
    const id = await newLeague();
    expect(await getProgram(deps(), pat, id)).toMatchObject({
      kind: "League",
      feeCents: null, // a League's fees are on its options: ALL Season when none are given
      options: [{ kind: "all_season", feeCents: 15000 }],
      status: "open",
      createdBy: "Dee X",
      divisionList: [],
    });
    // Registration Options, each with a fee; at least one; 2nd Game needs a way to play the day first.
    const opts = (o: unknown) => saveProgram(deps(), dee, id, league({ options: o }));
    expect(await opts([])).toEqual({ ok: false, message: "Pick at least one Registration Option." });
    expect(await opts([{ kind: "single_2nd", fee: "20" }])).toMatchObject({ ok: false });
    expect(await opts([{ kind: "all_season", fee: "12x" }])).toMatchObject({ ok: false });
    expect(
      await opts([
        { kind: "single_2", fee: "60" },
        { kind: "all_season", fee: "300" },
        { kind: "single_1", fee: "$35.50" },
        { kind: "single_2nd", fee: "" },
        { kind: "nope", fee: "1" },
      ]),
    ).toEqual({ ok: true, id });
    expect((await getProgram(deps(), pat, id))!.options).toEqual([
      { kind: "all_season", feeCents: 30000 },
      { kind: "single_1", feeCents: 3550 },
      { kind: "single_2", feeCents: 6000 },
      { kind: "single_2nd", feeCents: null },
    ]);
    await opts([{ kind: "all_season", fee: "150" }]);
    expect((await getProgram(deps(), pat, id))!.options).toEqual([{ kind: "all_season", feeCents: 15000 }]);
    expect(await saveProgram(deps(), dee, null, league({ name: "winter league 2027" }))).toEqual({
      ok: false,
      message: "There's already a program with that name.",
    });
    expect((await listPrograms(deps(), sam))!.programs.map((x) => `${x.name}:${x.status}`)).toEqual(["Winter League 2027:open"]);
    expect((await listPrograms(deps(), sam))!.canManage).toBe(false);
    expect((await listPrograms(deps(), dee))!.canManage).toBe(true);
  });

  it("checks program dates and fee on the server", async () => {
    expect(await saveProgram(deps(), dee, null, league({ kind: "Camp" }))).toEqual({
      ok: false,
      message: "Pick League, Circuit or Tournament.",
    });
    expect(await saveProgram(deps(), dee, null, league({ endsOn: "2026-12-01" }))).toEqual({
      ok: false,
      message: "The program ends before it starts.",
    });
    expect(await saveProgram(deps(), dee, null, league({ regCloses: "2026-10-01" }))).toEqual({
      ok: false,
      message: "Registration closes before it opens.",
    });
    expect(await saveProgram(deps(), dee, null, league({ fee: "=1+1" }))).toMatchObject({ ok: false, message: /fee/ });
    expect(await saveProgram(deps(), dee, null, league({ name: "@cmd" }))).toMatchObject({ ok: false });
    expect(await saveProgram(deps(), dee, null, league({ fee: "" }))).toMatchObject({ ok: true });
  });

  it("divisions group grades by gender; each grade gets a REC and/or COMP group with Pool A; no overlaps", async () => {
    const id = await newLeague();
    expect(await div(id, "Boys", 0, 1, ["REC"])).toEqual({ ok: true, label: "Boys K–1st" });
    expect(await div(id, "Boys", 2, 3, ["REC", "COMP"])).toEqual({ ok: true, label: "Boys 2nd–3rd" });
    expect(await div(id, "Girls", 2, 3, ["REC"])).toMatchObject({ ok: true }); // Girls stay separate
    expect(await div(id, "Boys", 3, 4, ["REC"])).toEqual({ ok: false, message: "That overlaps Boys 2nd–3rd." });
    expect(await div(id, "Boys", 6, 5, ["REC"])).toEqual({ ok: false, message: "The last grade is before the first." });
    expect(await div(id, "Coed", 6, 6, ["REC"])).toEqual({ ok: false, message: "Pick Boys or Girls." });
    expect(await div(id, "Boys", 6, 6, [])).toEqual({ ok: false, message: "Pick COMP, REC or both." });
    expect(await addDivision(deps(), fay, id, { gender: "Boys", from: 7, to: 8, levels: ["REC"] })).toMatchObject({ ok: false });

    const shape = (await getProgram(deps(), dee, id))!.divisionList.map(
      (d) => `${d.label}: ${d.groups.map((g) => `${g.label}[${g.pools.map((o) => o.name).join(",")}]`).join(" ")}`,
    );
    expect(shape).toEqual([
      "Boys K–1st: K REC[Pool A] 1st REC[Pool A]",
      "Boys 2nd–3rd: 2nd REC[Pool A] 2nd COMP[Pool A] 3rd REC[Pool A] 3rd COMP[Pool A]",
      "Girls 2nd–3rd: 2nd REC[Pool A] 3rd REC[Pool A]",
    ]);
  });

  it("teams go to the smallest pool of their grade and level (3rd/4th plays 4th); pools can be added, emptied, removed", async () => {
    const id = await newLeague();
    await div(id, "Boys", 3, 4, ["REC", "COMP"]);
    await div(id, "Girls", 4, 6, ["REC"]);
    const b34c = await team(pat, baylor, "Baylor 3/4 Comp", "Boys", "3-4", "COMP");
    const b5 = await team(pat, baylor, "Baylor 5th", "Boys", "5", "REC");
    const solo = await team(sam, "solo", "Sam Girls", "Girls", "5", "REC");

    const view = await getProgram(deps(), pat, id);
    expect(view!.canRegister).toEqual([
      { teamId: b34c, name: "Baylor 3/4 Comp (3rd/4th COMP)", division: "Boys 3rd–4th · 4th COMP" },
    ]);
    expect(view!.cantRegister).toEqual([{ name: "Baylor 5th", why: "no Boys 5th REC here" }]);

    expect(await registerTeam(deps(), pat, id, b34c, ALL)).toMatchObject({
      ok: true,
      division: "Boys 3rd–4th · 4th COMP · Pool A",
    });
    expect(await registerTeam(deps(), pat, id, b34c, ALL)).toEqual({ ok: false, message: "Already registered for ALL Season." });
    expect(await registerTeam(deps(), pat, id, b5, ALL)).toEqual({ ok: false, message: "This program has no Boys 5th REC." });
    expect(await registerTeam(deps(), pat, id, solo, ALL)).toEqual({
      ok: false,
      message: "You can only register teams you manage.",
    });

    // Add Pool B to Girls 5th REC: the next team goes to the emptier pool.
    const girls5 = () => getProgram(deps(), dee, id).then((p) => p!.divisionList[1].groups.find((g) => g.label === "5th REC")!);
    expect(await addPool(deps(), dee, (await girls5()).id)).toEqual({ ok: true, name: "Pool B" });
    expect(await addPool(deps(), pat, (await girls5()).id)).toMatchObject({ ok: false });
    expect(await registerTeam(deps(), sam, id, solo, ALL)).toMatchObject({
      ok: true,
      division: "Girls 4th–6th · 5th REC · Pool A",
    });
    const g2 = await team(sam, "solo", "Sam Girls 2", "Girls", "5", "REC");
    expect(await registerTeam(deps(), sam, id, g2, ALL)).toMatchObject({
      ok: true,
      division: "Girls 4th–6th · 5th REC · Pool B",
    });

    // Move between pools of the same grade group (recorded); not into another grade's pool.
    const [poolA, poolB] = (await girls5()).pools;
    const other = (await getProgram(deps(), dee, id))!.divisionList[1].groups.find((g) => g.label === "4th REC")!.pools[0];
    expect(await moveTeam(deps(), dee, id, g2, other.id)).toEqual({
      ok: false,
      message: "Pick another pool in the same grade group.",
    });
    expect(await moveTeam(deps(), sam, id, g2, poolA.id)).toMatchObject({ ok: false });
    expect(await moveTeam(deps(), dee, id, g2, poolA.id)).toEqual({ ok: true });
    const after = await girls5();
    expect(after.pools.map((o) => `${o.name}:${o.teams.map((t) => `${t.name}/${t.movedBy ?? "-"}`).join(",")}`)).toEqual([
      "Pool A:Sam Girls/-,Sam Girls 2/Dee X",
      "Pool B:",
    ]);
    expect(await removePool(deps(), dee, poolA.id)).toEqual({ ok: false, message: "Pool A has teams. Move them first." });
    expect(await removePool(deps(), dee, poolB.id)).toEqual({ ok: true });
    expect(await removePool(deps(), dee, poolA.id)).toMatchObject({ ok: false });
    expect((await getProgram(deps(), sam, id))!.teams).toBe(3);
  });

  it("registration window: closed means no sign-ups or withdrawals except by a Director of Programs", async () => {
    const id = await newLeague();
    await div(id, "Boys", 5, 5, ["REC"]);
    const b5 = await team(pat, baylor, "Baylor 5th", "Boys", "5");
    now = new Date("2026-12-16T15:00:00Z"); // the day after it closes
    expect(await registerTeam(deps(), pat, id, b5, ALL)).toEqual({
      ok: false,
      message: "Registration isn't open for this program.",
    });
    expect((await getProgram(deps(), pat, id))!.canRegister).toEqual([]);
    expect(await registerTeam(deps(), dee, id, b5, ALL)).toMatchObject({ ok: true });
    expect(await withdrawTeam(deps(), pat, id, b5)).toEqual({
      ok: false,
      message: "Registration is closed. Ask a Director of Programs.",
    });
    expect(await withdrawTeam(deps(), dee, id, b5)).toEqual({ ok: true });
  });

  it("Paid is set by Directors of Programs and recorded; a division with teams can't be removed; delete removes it all", async () => {
    const id = await newLeague();
    await div(id, "Boys", 5, 5, ["REC"]);
    await div(id, "Girls", 5, 5, ["REC"]);
    const b5 = await team(pat, baylor, "Baylor 5th", "Boys", "5");
    await registerTeam(deps(), pat, id, b5, ALL);
    expect(await setPaid(deps(), pat, id, b5, true)).toMatchObject({ ok: false });
    expect(await setPaid(deps(), dee, id, b5, true)).toEqual({ ok: true });
    expect((await db.pool.query("select paid, paid_set_by from scenic_registrations")).rows[0]).toEqual({
      paid: true,
      paid_set_by: "Dee X",
    });

    const [boys, girls] = (await getProgram(deps(), dee, id))!.divisionList;
    expect(await removeDivision(deps(), dee, boys.id)).toEqual({
      ok: false,
      message: "Boys 5th has teams registered. Withdraw them first.",
    });
    expect(await removeDivision(deps(), pat, girls.id)).toMatchObject({ ok: false });
    expect(await removeDivision(deps(), dee, girls.id)).toEqual({ ok: true });

    expect(await saveProgram(deps(), dee, id, league({ fee: "175" }))).toMatchObject({ ok: true }); // editing keeps divisions
    expect((await getProgram(deps(), dee, id))!.divisionList.map((d) => d.label)).toEqual(["Boys 5th"]);

    expect(await deleteProgram(deps(), pat, id)).toMatchObject({ ok: false });
    expect(await deleteProgram(deps(), dee, id)).toEqual({ ok: true });
    expect((await db.pool.query("select count(*)::int n from scenic_registrations")).rows[0].n).toBe(0);
    expect((await db.pool.query("select count(*)::int n from scenic_teams")).rows[0].n).toBe(1); // the team stays
  });

  it("game dates: within the season, become Scenic City game days, and leave them when no program or court hours need them", async () => {
    const id = await newLeague(); // season Jan 9 – Mar 6, 2027
    const other = await newLeague({ name: "Winter Circuit", kind: "Circuit" });
    const dates = (pid: string) => getProgram(deps(), dee, pid).then((p) => p!.gameDates);
    expect(await saveProgramDates(deps(), pat, id, { add: ["2027-01-09"], remove: [] })).toMatchObject({ ok: false });
    expect(await saveProgramDates(deps(), fay, id, { add: ["2027-01-09"], remove: [] })).toMatchObject({ ok: false });
    expect(await saveProgramDates(deps(), dee, id, { add: ["2027-03-07"], remove: [] })).toEqual({
      ok: false,
      message: "Game dates must be within the program's season.",
    });
    expect(await saveProgramDates(deps(), dee, id, { add: ["2027-01-09", "2027-01-16", "2027-01-23"], remove: [] })).toEqual({
      ok: true,
      added: 3,
      removed: 0,
      kept: 0,
    });
    await saveProgramDates(deps(), dee, other, { add: ["2027-01-16"], remove: [] });
    expect(await dates(id)).toEqual(["2027-01-09", "2027-01-16", "2027-01-23"]);

    // Bracket Days: added as brackets, or an existing Game Day switched; a date can't be both.
    expect(
      await saveProgramDates(deps(), dee, id, { add: [], addBrackets: ["2027-03-06", "2027-01-23"], remove: [] }),
    ).toMatchObject({ ok: true, added: 1 });
    expect(
      await saveProgramDates(deps(), dee, id, { add: ["2027-03-05"], addBrackets: ["2027-03-05"], remove: [] }),
    ).toMatchObject({ ok: false });
    const p = (await getProgram(deps(), dee, id))!;
    expect([p.gameDates, p.bracketDates]).toEqual([
      ["2027-01-09", "2027-01-16"],
      ["2027-01-23", "2027-03-06"],
    ]);
    await saveProgramDates(deps(), dee, id, { add: ["2027-01-23"], remove: ["2027-03-06"] }); // back to the way it was
    expect((await listGameDays(deps(), sam))!.map((d) => `${d.day}:${d.programs.join("+")}`)).toEqual([
      "2027-01-09:Winter League 2027",
      "2027-01-16:Winter Circuit+Winter League 2027",
      "2027-01-23:Winter League 2027",
    ]);

    // Court hours on Jan 23 keep that game day; Jan 16 stays for the Circuit; Jan 9 goes.
    const g = await db.pool.query<{ id: string }>(
      "insert into partner_gyms (partner_id, name, created_by) values ($1, 'Gym', 'x') returning id::text",
      [baylor],
    );
    const c = await db.pool.query<{ id: string }>(
      "insert into partner_courts (gym_id, name, created_by) values ($1, '1', 'x') returning id::text",
      [g.rows[0].id],
    );
    await db.pool.query(
      `insert into court_hours (court_id, game_day_id, starts, ends, set_by) select $1, id, '09:00', '21:00', 'x' from game_days where day = '2027-01-23'`,
      [c.rows[0].id],
    );
    expect(await saveProgramDates(deps(), dee, id, { add: [], remove: ["2027-01-09", "2027-01-16", "2027-01-23"] })).toEqual({
      ok: true,
      added: 0,
      removed: 3,
      kept: 2,
    });
    expect(await dates(id)).toEqual([]);
    expect((await listGameDays(deps(), sam))!.map((d) => `${d.day}:${d.programs.join("+")}`)).toEqual([
      "2027-01-16:Winter Circuit",
      "2027-01-23:",
    ]);

    now = new Date("2027-01-20T15:00:00Z");
    expect(await saveProgramDates(deps(), dee, other, { add: [], remove: ["2027-01-16"] })).toEqual({
      ok: false,
      message: "Past game dates can't change.",
    });
  });

  it("copies another program's divisions (grade groups and pools, no teams); skips overlaps", async () => {
    const a = await newLeague();
    const b = await newLeague({ name: "Spring League 2027" });
    await div(a, "Boys", 3, 4, ["REC", "COMP"]);
    await div(a, "Girls", 5, 5, ["REC"]);
    const g = await db.pool.query<{ id: string }>(
      `select g.id::text from scenic_grade_groups g join scenic_divisions d on d.id = g.division_id
       where d.program_id = $1 and d.gender = 'Boys' and g.grade = 4 and g.level = 'REC'`,
      [a],
    );
    await addPool(deps(), dee, g.rows[0].id);
    await div(b, "Girls", 5, 6, ["COMP"]);

    expect(await copyDivisions(deps(), pat, b, a)).toMatchObject({ ok: false });
    expect(await copyDivisions(deps(), dee, b, b)).toMatchObject({ ok: false });
    expect(await copyDivisions(deps(), dee, b, a)).toEqual({ ok: true, copied: ["Boys 3rd–4th"], skipped: ["Girls 5th"] });
    const p = (await getProgram(deps(), dee, b))!;
    expect(
      p.divisionList.map(
        (d) => `${d.label}: ${d.groups.map((x) => `${x.label} ${x.pools.map((o) => o.name).join("/")}`).join(", ")}`,
      ),
    ).toEqual([
      "Boys 3rd–4th: 3rd REC Pool A, 3rd COMP Pool A, 4th REC Pool A/Pool B, 4th COMP Pool A",
      "Girls 5th–6th: 5th COMP Pool A, 6th COMP Pool A",
    ]);
  });

  it("Admins and Directors of Scheduling take a team out of a Game Day, the Brackets or the program, and restore it", async () => {
    const id = await newLeague();
    await saveProgramDates(deps(), dee, id, { add: ["2027-01-09", "2027-01-16"], addBrackets: ["2027-03-06"], remove: [] });
    await div(id, "Boys", 3, 4, ["COMP"]);
    const t = await team(pat, baylor, "Baylor 3/4", "Boys", "3-4", "COMP");
    await registerTeam(deps(), pat, id, t, ALL);
    const off = (who: SessionUser, what: string, out = true) => setTeamOff(deps(), who, id, t, what, out);
    const shown = async () =>
      (await getProgram(deps(), dee, id))!.divisionList[0].groups.flatMap((g) => g.pools.flatMap((o) => o.teams))[0];

    expect(await off(dee, "2027-01-09")).toEqual({
      ok: false,
      message: "Only a Scenic City Admin or Director of Scheduling can do that.",
    });
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'scenic-city', 'scheduling', 'test')",
    );
    expect((await getProgram(deps(), fay, id))!.canSchedule).toBe(true);
    expect(await off(fay, "2027-01-10")).toEqual({ ok: false, message: "That isn't one of this program's Game Days." });
    expect(await off(fay, "2027-03-06")).toMatchObject({ ok: false }); // a Bracket Day: use "brackets"
    expect(await off(fay, "2027-01-09")).toEqual({ ok: true });
    expect(await off(fay, "brackets")).toEqual({ ok: true });
    expect(await off(fay, "program")).toEqual({ ok: true });
    expect(await shown()).toMatchObject({
      name: "Baylor 3/4",
      removedBy: "Fay X",
      off: { "2027-01-09": "Fay X", brackets: "Fay X" },
    });
    // Restore: still registered all along.
    expect(await off(fay, "program", false)).toEqual({ ok: true });
    expect(await off(fay, "2027-01-09", false)).toEqual({ ok: true });
    expect(await shown()).toMatchObject({ removedBy: null, off: { brackets: "Fay X" } });
  });
});
