import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";

const ALL = { allSeason: true, days: [] }; // register for ALL Season
import {
  gameDaySchedule,
  registerAllScenicTeams,
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
  setGradeLevel,
  setRecLimit,
  recLimit,
  setTeamOff,
  setTeamsOff,
  setPaid,
  withdrawTeam,
  withdrawTeams,
} from "./scenic-programs";
import { listGameDays } from "./scenic-partners";
import { createDayMatchups, createMatchups, saveMatchups } from "./scenic-matchups";
import { placeGame, setGameLength } from "./scenic-grid";
import { bindTeams, listBindings, unbind } from "./scenic-bindings";
import { listCourts, setCourtDivisions } from "./scenic-courts";
import { scheduledGames } from "./scenic-games";
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
    const open = { closesOn: null, closesDaysBefore: null }; // no own close: with the program's registration
    expect((await getProgram(deps(), pat, id))!.options).toEqual([
      { kind: "all_season", feeCents: 30000, ...open },
      { kind: "single_1", feeCents: 3550, ...open },
      { kind: "single_2", feeCents: 6000, ...open },
      { kind: "single_2nd", feeCents: null, ...open },
    ]);
    await opts([{ kind: "all_season", fee: "150" }]);
    expect((await getProgram(deps(), pat, id))!.options).toEqual([{ kind: "all_season", feeCents: 15000, ...open }]);

    // Each option's own close: a date within registration (Nov 1 – Dec 15), or 0–365 days before; not both.
    expect(await opts([{ kind: "all_season", fee: "150", closesOn: "2026-12-20" }])).toEqual({
      ok: false,
      message: "ALL Season: its close date must be within registration (2026-11-01 to 2026-12-15).",
    });
    expect(await opts([{ kind: "single_1", fee: "40", closesDaysBefore: "400" }])).toMatchObject({ ok: false });
    expect(await opts([{ kind: "single_1", fee: "40", closesOn: "2026-12-01", closesDaysBefore: 3 }])).toMatchObject({
      ok: false,
    });
    expect(
      await opts([
        { kind: "all_season", fee: "150", closesOn: "2026-12-01" },
        { kind: "single_1", fee: "40", closesDaysBefore: "3" },
      ]),
    ).toEqual({ ok: true, id });
    expect((await getProgram(deps(), pat, id))!.options).toEqual([
      { kind: "all_season", feeCents: 15000, closesOn: "2026-12-01", closesDaysBefore: null },
      { kind: "single_1", feeCents: 4000, closesOn: null, closesDaysBefore: 3 },
    ]);
    await opts([{ kind: "all_season", fee: "150" }]);
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
    expect(await div(id, "Coed", 6, 6, ["REC"])).toEqual({
      ok: false,
      message: "Pre-K is its own Coed division (Pre-K only); Boys and Girls divisions start at K.",
    });
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

  it("Grades accepted: REC and COMP turned on or off per grade, Boys and Girls separately; not while teams are in it", async () => {
    const id = await newLeague();
    await div(id, "Boys", 3, 4, ["COMP"]);
    await div(id, "Girls", 3, 4, ["REC", "COMP"]);
    const set = (who: SessionUser, gender: string, grade: number, level: string, on: boolean) =>
      setGradeLevel(deps(), who, id, { gender, grade, level, on });
    const groups = async () =>
      (await getProgram(deps(), dee, id))!.divisionList.map((d) => `${d.gender}: ${d.groups.map((g) => g.label).join(", ")}`);

    expect(await set(fay, "Boys", 3, "REC", true)).toEqual({ ok: false, message: "Only a Scenic City Director of Programs can do that." });
    // Boys 3rd REC on: only Boys; Girls unchanged.
    expect(await set(dee, "Boys", 3, "REC", true)).toEqual({ ok: true });
    expect(await set(dee, "Boys", 3, "REC", true)).toEqual({ ok: true }); // already on
    expect(await groups()).toEqual([
      "Boys: 3rd REC, 3rd COMP, 4th COMP",
      "Girls: 3rd REC, 3rd COMP, 4th REC, 4th COMP",
    ]);
    // Girls 4th COMP off.
    expect(await set(dee, "Girls", 4, "COMP", false)).toEqual({ ok: true });
    expect((await groups())[1]).toBe("Girls: 3rd REC, 3rd COMP, 4th REC");
    // A grade with no division, and bad input.
    expect(await set(dee, "Boys", 7, "REC", true)).toEqual({ ok: false, message: "No Boys division has 7th. Add a division first." });
    expect(await set(dee, "Coed", 0, "REC", true)).toMatchObject({ ok: false });
    expect(await set(dee, "Coed", -1, "COMP", true)).toEqual({ ok: false, message: "Pre-K is REC only." });
    // Coed Pre-K on adds its division (REC, Pool A); off removes it.
    expect(await set(dee, "Coed", -1, "REC", true)).toEqual({ ok: true });
    expect((await groups())[0]).toBe("Coed: Pre-K REC");
    expect(await set(dee, "Coed", -1, "REC", false)).toEqual({ ok: true });
    expect(await groups()).toHaveLength(2);
    expect(await set(dee, "Boys", 3, "ELITE", true)).toMatchObject({ ok: false });
    // Not while a team is in it; a registered team's new group gets Pool A and takes teams.
    const b3 = await team(pat, baylor, "Baylor 3rd", "Boys", "3", "REC");
    expect(await registerTeam(deps(), pat, id, b3, ALL)).toMatchObject({ ok: true, division: "Boys 3rd–4th · 3rd REC · Pool A" });
    expect(await set(dee, "Boys", 3, "REC", false)).toEqual({
      ok: false,
      message: "Boys 3rd REC has 1 team. Withdraw or move them first.",
    });
    // A division keeps at least one grade.
    const solo = await newLeague({ name: "Spring" });
    await div(solo, "Boys", 5, 5, ["REC"]);
    expect(await setGradeLevel(deps(), dee, solo, { gender: "Boys", grade: 5, level: "REC", on: false })).toEqual({
      ok: false,
      message: "Boys 5th REC is its division's last grade. Remove the division instead.",
    });
  });

  it("REC open to: only the organizations picked (no stand-alone teams); COMP open to all; checked on the server", async () => {
    const id = await newLeague();
    await div(id, "Boys", 5, 5, ["REC", "COMP"]);
    await div(id, "Girls", 5, 5, ["REC"]);
    const other = (
      await db.pool.query<{ id: string }>(
        `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values ('Other Club', 'Organization', false, true, true, 'test')
         returning id::text`,
      )
    ).rows[0].id;
    const rec5 = await team(pat, baylor, "Baylor 5 Rec", "Boys", "5", "REC");
    const comp5 = await team(pat, baylor, "Baylor 5 Comp", "Boys", "5", "COMP");
    const solo = await team(sam, "solo", "Sam Girls", "Girls", "5", "REC");
    // Only organizations with CourtOrg and CourtSync can be picked: Other Club and Baylor get both; a school with only
    // CourtSync can't.
    await db.pool.query(
      `insert into organizations (slug, name, short_name, kind) values ('other-club', 'Other Club', 'OC', 'Organization'),
              ('baylor', 'Baylor School', 'Baylor', 'School'), ('high', 'High School', 'HS', 'School')`,
    );
    const school = (
      await db.pool.query<{ id: string }>(
        `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug)
         values ('High School', 'School', true, false, true, 'test', 'high') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query("update partners set org_slug = 'other-club' where id = $1", [other]);
    await db.pool.query("update partners set org_slug = 'baylor' where id = $1", [baylor]);
    await db.pool.query(
      `insert into org_features (org, feature, source) values ('other-club', 'court-org', 'setup'),
              ('other-club', 'court-sync', 'setup'), ('baylor', 'court-org', 'setup'), ('baylor', 'court-sync', 'setup'),
              ('high', 'court-sync', 'setup')`,
    );
    expect((await recLimit(db.pool, id)).choices.map((c) => c.name)).toEqual(["Baylor School", "Other Club"]);
    expect(await setRecLimit(deps(), dee, id, { limited: true, partners: [school] })).toEqual({
      ok: false,
      message: "Pick organizations from the list.",
    });

    expect(await setRecLimit(deps(), fay, id, { limited: true, partners: [other] })).toMatchObject({ ok: false });
    expect(await setRecLimit(deps(), dee, id, { limited: true, partners: [] })).toEqual({
      ok: false,
      message: "Pick at least one organization, or open REC to everyone.",
    });
    expect(await setRecLimit(deps(), dee, id, { limited: true, partners: ["999999"] })).toEqual({
      ok: false,
      message: "Pick organizations from the list.",
    });
    expect(await setRecLimit(deps(), dee, id, { limited: true, partners: [other] })).toEqual({ ok: true });
    expect(await recLimit(db.pool, id)).toMatchObject({ limited: true, by: "Dee X", partners: [other] });

    // Baylor isn't picked: its REC team can't register (and isn't offered); COMP can. Solo REC can't either.
    expect((await getProgram(deps(), pat, id))!.cantRegister).toEqual([
      { name: "Baylor 5 Rec", why: "REC here is only for the organizations Scenic City picked" },
    ]);
    expect(await registerTeam(deps(), pat, id, rec5, ALL)).toEqual({
      ok: false,
      message: "REC in this program is only for the organizations Scenic City picked. COMP is open to all.",
    });
    expect(await registerTeam(deps(), pat, id, comp5, ALL)).toMatchObject({ ok: true });
    expect(await registerTeam(deps(), sam, id, solo, ALL)).toMatchObject({ ok: false });

    // Baylor picked: its REC team registers. Open to everyone again: the Solo team too.
    expect(await setRecLimit(deps(), dee, id, { limited: true, partners: [other, baylor] })).toEqual({ ok: true });
    expect(await registerTeam(deps(), pat, id, rec5, ALL)).toMatchObject({ ok: true });
    expect(await setRecLimit(deps(), dee, id, { limited: false, partners: [] })).toEqual({ ok: true });
    expect(await recLimit(db.pool, id)).toMatchObject({ limited: false, by: null, partners: [] });
    expect(await registerTeam(deps(), sam, id, solo, ALL)).toMatchObject({ ok: true });
  });

  it("each option's own close: refused after it (ALL Season by date, Single Day N days before each date)", async () => {
    const id = await newLeague({
      regCloses: "2027-01-20",
      options: [
        { kind: "all_season", fee: "150", closesOn: "2026-11-20" },
        { kind: "single_1", fee: "40", closesDaysBefore: 3 },
      ],
    });
    await saveProgramDates(deps(), dee, id, { add: ["2027-01-09", "2027-01-16"], remove: [] });
    await div(id, "Boys", 5, 5, ["REC"]);
    const a = await team(pat, baylor, "Baylor A", "Boys", "5");
    const b = await team(pat, baylor, "Baylor B", "Boys", "5");
    now = new Date("2026-11-21T15:00:00Z"); // after ALL Season closed (Nov 20)
    expect(await registerTeam(deps(), pat, id, a, ALL)).toEqual({ ok: false, message: "ALL Season registration closed Nov 20." });
    // Jan 9 closes Jan 6 (3 days before): open on Nov 21.
    const jan9 = { allSeason: false, days: [{ date: "2027-01-09", kind: "single_1" }] };
    expect(await registerTeam(deps(), pat, id, a, jan9)).toMatchObject({ ok: true });
    now = new Date("2027-01-07T15:00:00Z"); // Jan 9 closed; Jan 16 still open
    expect(await registerTeam(deps(), pat, id, b, jan9)).toEqual({
      ok: false,
      message: "1 Game – Single Day for Jan 9 closed Jan 6.",
    });
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

  it("Register all: every team this person can register here, each to its division (ALL Season); the rest skipped, saying why", async () => {
    const id = await newLeague();
    await div(id, "Boys", 3, 4, ["REC", "COMP"]);
    const b34c = await team(pat, baylor, "Baylor 3/4 Comp", "Boys", "3-4", "COMP");
    await team(pat, baylor, "Baylor 4 Rec", "Boys", "4", "REC");
    await team(pat, baylor, "Baylor 5th", "Boys", "5", "REC");
    await team(sam, "solo", "Sam Girls", "Girls", "5", "REC"); // not Pat's
    expect(await registerTeam(deps(), pat, id, b34c, ALL)).toMatchObject({ ok: true });
    expect(await registerAllScenicTeams(deps(), pat, id)).toMatchObject({
      ok: true,
      registered: ["Baylor 4 Rec: Boys 3rd–4th · 4th REC · Pool A"],
      skipped: ["Baylor 5th: This program has no Boys 5th REC."],
    });
    expect((await getProgram(deps(), dee, id))!.teams).toBe(2);
    expect(await registerAllScenicTeams(deps(), pat, "x")).toMatchObject({ ok: false });
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
    // Not with teams registered: withdraw them first.
    expect(await deleteProgram(deps(), dee, id)).toEqual({ ok: false, message: "It has 1 team registered. Withdraw them first." });
    expect(await withdrawTeam(deps(), dee, id, b5)).toEqual({ ok: true });
    expect(await deleteProgram(deps(), dee, id)).toEqual({ ok: true });
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
  it("picked teams: taken out of the program or withdrawn together", async () => {
    const id = await newLeague();
    await div(id, "Boys", 3, 4, ["COMP"]);
    const ts = [
      await team(pat, baylor, "Baylor A", "Boys", "3-4", "COMP"),
      await team(pat, baylor, "Baylor B", "Boys", "3-4", "COMP"),
      await team(pat, baylor, "Baylor C", "Boys", "3-4", "COMP"),
    ];
    for (const t of ts) await registerTeam(deps(), pat, id, t, ALL);
    const listed = async () =>
      (await getProgram(deps(), dee, id))!.divisionList[0].groups
        .flatMap((g) => g.pools.flatMap((o) => o.teams))
        .map((t) => `${t.name}${t.removedBy ? " out" : ""}`)
        .sort();

    expect(await setTeamsOff(deps(), pat, id, ts.slice(0, 2), true)).toEqual({
      ok: false,
      message: "Only a Scenic City Admin or Director of Scheduling can do that.",
    });
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'scenic-city', 'scheduling', 'test')",
    );
    expect(await setTeamsOff(deps(), fay, id, [], true)).toEqual({ ok: false, message: "Pick at least one team." });
    expect(await setTeamsOff(deps(), fay, id, ["x"], true)).toEqual({ ok: false, message: "Pick at least one team." });
    expect(await setTeamsOff(deps(), fay, id, ts.slice(0, 2), true)).toEqual({ ok: true, changed: 2 });
    expect(await setTeamsOff(deps(), fay, id, ts, true)).toEqual({ ok: true, changed: 1 }); // the 2 already out stay as they were
    expect(await listed()).toEqual(["Baylor A out", "Baylor B out", "Baylor C out"]);
    expect(await setTeamsOff(deps(), fay, id, [ts[0]], false)).toEqual({ ok: true, changed: 1 });

    expect(await withdrawTeams(deps(), fay, id, ts)).toMatchObject({ ok: false }); // Scheduling isn't Programs
    expect(await withdrawTeams(deps(), dee, id, [ts[1], ts[2]])).toEqual({ ok: true, withdrawn: 2 });
    expect(await listed()).toEqual(["Baylor A"]);
  });

  it("the Scheduler lists every League's upcoming Game Days with the teams playing (Directors of Scheduling only)", async () => {
    const a = await newLeague();
    const b = await newLeague({ name: "Spring League 2027" });
    await saveProgramDates(deps(), dee, a, { add: ["2027-01-09", "2027-01-16"], addBrackets: ["2027-03-06"], remove: [] });
    await saveProgramDates(deps(), dee, b, { add: ["2027-01-16"], addBrackets: [], remove: [] });
    await div(a, "Boys", 3, 4, ["COMP"]);
    await div(b, "Boys", 3, 4, ["COMP"]);
    const t1 = await team(pat, baylor, "Baylor 3/4", "Boys", "3-4", "COMP");
    const t2 = await team(pat, baylor, "Baylor 4th", "Boys", "4", "COMP");
    await registerTeam(deps(), pat, a, t1, ALL);
    expect(await registerTeam(deps(), pat, b, t2, ALL)).toMatchObject({ ok: true });

    expect(await gameDaySchedule(deps(), fay)).toBeNull(); // Facilities only
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'scenic-city', 'scheduling', 'test')",
    );
    await setTeamOff(deps(), fay, a, t1, "2027-01-09", true);
    const s = (await gameDaySchedule(deps(), fay))!;
    expect(
      s.days.map((d) => ({
        date: d.date,
        playing: d.playing,
        games: d.games,
        programs: d.programs.map(
          (p) => `${p.programName}: ${p.teams.map((t) => `${t.name} ${t.note}${t.out ? " (out)" : ""}`).join(", ")}`,
        ),
      })),
    ).toEqual([
      { date: "2027-01-09", playing: 0, games: 0, programs: ["Winter League 2027: Baylor 3/4 1GG (out)"] },
      {
        date: "2027-01-16",
        playing: 2,
        games: 2,
        programs: ["Spring League 2027: Baylor 4th 1GG", "Winter League 2027: Baylor 3/4 1GG"],
      },
      { date: "2027-03-06", playing: 1, games: 0, programs: ["Winter League 2027: Baylor 3/4 Bracket"] },
    ]);
    // Past Game Days drop off.
    now = new Date("2027-01-12T15:00:00Z");
    expect((await gameDaySchedule(deps(), fay))!.days.map((d) => d.date)).toEqual(["2027-01-16", "2027-03-06"]);
  });
  it("Create all matchups: every division that day; a coach's teams are all home or all away", async () => {
    const id = await newLeague();
    await saveProgramDates(deps(), dee, id, { add: ["2027-01-09"], addBrackets: [], remove: [] });
    await div(id, "Boys", 3, 4, ["COMP"]);
    await div(id, "Girls", 3, 4, ["COMP"]);
    // Coach Cy has a Boys and a Girls team at Baylor; Sam's teams each have their own coach.
    const make = async (who: SessionUser, forWhom: string, name: string, gender: string, first: string, cell: string) => {
      const t = (
        (await createScenicTeam(deps(), who, {
          for: forWhom,
          name,
          gender,
          level: "COMP",
          grade: "4",
          coachFirst: first,
          coachLast: "Coach",
          coachCell: cell,
        })) as { id: string }
      ).id;
      expect(await registerTeam(deps(), who, id, t, ALL)).toMatchObject({ ok: true });
      return t;
    };
    const b1 = await make(pat, baylor, "Baylor 4B", "Boys", "Cy", "4235550003");
    await make(sam, "solo", "Sam 4B", "Boys", "Ann", "4235550005");
    const g1 = await make(pat, baylor, "Baylor 4G", "Girls", "Cy", "4235550003");
    await make(sam, "solo", "Sam 4G", "Girls", "Bo", "4235550006");
    expect(await createDayMatchups(deps(), fay, "2027-01-09")).toMatchObject({ ok: false });
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'scenic-city', 'scheduling', 'test')",
    );
    expect(await createDayMatchups(deps(), fay, "bad")).toEqual({ ok: false, message: "Pick a Game Day." });
    expect(await createDayMatchups(deps(), fay, "2027-01-09")).toEqual({ ok: true, created: 2, divisions: 2, notes: [] });
    const home = async () => {
      const m = (await gameDaySchedule(deps(), fay))!.days[0].programs[0].matchups;
      const isHome = (t: string) => m.some((x) => (x.a === t && x.home === "a") || (x.b === t && x.home === "b"));
      return [isHome(b1), isHome(g1)];
    };
    // Without the coach, Baylor would split its two games (one home, one away); Cy's teams go together instead.
    const [x, y] = await home();
    expect(x).toBe(y);
    // Again: replaces the day's matchups, still together.
    expect(await createDayMatchups(deps(), fay, "2027-01-09")).toMatchObject({ ok: true, created: 2 });
    const [x2, y2] = await home();
    expect(x2).toBe(y2);
  });

  it("Assistant Coaches count too: they link teams for home/away and never have two games at once", async () => {
    const id = await newLeague();
    await saveProgramDates(deps(), dee, id, { add: ["2027-01-09"], addBrackets: [], remove: [] });
    await div(id, "Boys", 3, 4, ["COMP"]);
    await div(id, "Girls", 3, 4, ["COMP"]);
    const make = async (who: SessionUser, forWhom: string, name: string, gender: string, first: string, cell: string) => {
      const t = (
        (await createScenicTeam(deps(), who, {
          for: forWhom,
          name,
          gender,
          level: "COMP",
          grade: "4",
          coachFirst: first,
          coachLast: "Coach",
          coachCell: cell,
        })) as { id: string }
      ).id;
      expect(await registerTeam(deps(), who, id, t, ALL)).toMatchObject({ ok: true });
      return t;
    };
    // Cy is the Head Coach of Baylor 4B and an Assistant Coach of Baylor 4G (its Thunder team's staff); Eve is 4G's Head.
    const b1 = await make(pat, baylor, "Baylor 4B", "Boys", "Cy", "4235550003");
    await make(sam, "solo", "Sam 4B", "Boys", "Ann", "4235550005");
    const g1 = await make(pat, baylor, "Baylor 4G", "Girls", "Eve", "4235550007");
    await make(sam, "solo", "Sam 4G", "Girls", "Bo", "4235550006");
    const cy = (await db.pool.query<{ id: string }>("select coach_id as id from users where cell = '4235550003'")).rows[0].id;
    const th = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Coach', 'Girls', '{4}', 4, 'COMP', 'x')
       returning id::text`,
    );
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, $2, 'AsstCoach', 'x')", [
      th.rows[0].id,
      cy,
    ]);
    await db.pool.query("update scenic_teams set thunder_team_id = $1 where id = $2", [th.rows[0].id, g1]);
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'scenic-city', 'scheduling', 'test')",
    );
    const day = () => gameDaySchedule(deps(), fay).then((s) => s!.days[0].programs[0]);
    const coaches = (await day()).teams.find((t) => t.teamId === g1)!.coaches;
    expect(coaches.map((c) => [c.name, c.head])).toEqual([
      ["Eve Coach", true],
      ["Cy Coach", false],
    ]);
    // Without Cy as assistant, Baylor would split its two games; linked, they're both home or both away.
    expect(await createDayMatchups(deps(), fay, "2027-01-09")).toMatchObject({ ok: true, created: 2 });
    const m = (await day()).matchups;
    const isHome = (t: string) => m.some((x) => (x.a === t && x.home === "a") || (x.b === t && x.home === "b"));
    expect(isHome(b1)).toBe(isHome(g1));

    // Grid: two courts; Cy's two games can't overlap.
    const gym = await db.pool.query<{ id: string }>(
      "insert into partner_gyms (partner_id, name, created_by) values ($1, 'Main Gym', 't') returning id::text",
      [baylor],
    );
    const courts = (
      await db.pool.query<{ id: string }>(
        "insert into partner_courts (gym_id, name, created_by) values ($1, 'Court 1', 't'), ($1, 'Court 2', 't') returning id::text",
        [gym.rows[0].id],
      )
    ).rows.map((r) => r.id);
    await db.pool.query(
      `insert into court_hours (court_id, game_day_id, starts, ends, set_by)
       select c, g.id, '09:00', '12:00', 't' from unnest($1::bigint[]) c, game_days g where g.day = '2027-01-09'`,
      [courts],
    );
    const gameOf = (t: string) => m.find((x) => x.a === t || x.b === t)!.id;
    expect(await placeGame(deps(), fay, gameOf(b1), { court: courts[0], starts: "09:00" })).toEqual({ ok: true });
    expect(await placeGame(deps(), fay, gameOf(g1), { court: courts[1], starts: "09:00" })).toEqual({
      ok: false,
      message: "Cy Coach already coaches a game then (one coach, one game at a time).",
    });
    expect(await placeGame(deps(), fay, gameOf(g1), { court: courts[1], starts: "09:55" })).toEqual({ ok: true });
  });

  it("Bindings by hand: Schedulers bind teams with a reason; bound teams go together and never play at once; Unbind", async () => {
    const id = await newLeague();
    await saveProgramDates(deps(), dee, id, { add: ["2027-01-09"], addBrackets: [], remove: [] });
    await div(id, "Boys", 3, 4, ["COMP"]);
    await div(id, "Girls", 3, 4, ["COMP"]);
    const make = async (who: SessionUser, forWhom: string, name: string, gender: string, first: string, cell: string) => {
      const t = (
        (await createScenicTeam(deps(), who, {
          for: forWhom,
          name,
          gender,
          level: "COMP",
          grade: "4",
          coachFirst: first,
          coachLast: "Coach",
          coachCell: cell,
        })) as { id: string }
      ).id;
      expect(await registerTeam(deps(), who, id, t, ALL)).toMatchObject({ ok: true });
      return t;
    };
    // Four different coaches: nothing links Baylor 4B and Baylor 4G until they're bound.
    const b1 = await make(pat, baylor, "Baylor 4B", "Boys", "Cy", "4235550003");
    await make(sam, "solo", "Sam 4B", "Boys", "Ann", "4235550005");
    const g1 = await make(pat, baylor, "Baylor 4G", "Girls", "Eve", "4235550007");
    await make(sam, "solo", "Sam 4G", "Girls", "Bo", "4235550006");
    expect(await bindTeams(deps(), fay, [b1, g1], "Same family")).toEqual({
      ok: false,
      message: "Only a Scenic City Admin or Director of Scheduling can do that.",
    });
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'scenic-city', 'scheduling', 'test')",
    );
    expect(await bindTeams(deps(), fay, [b1], "")).toEqual({ ok: false, message: "Pick at least two teams to bind." });
    expect(await bindTeams(deps(), fay, [b1, "x"], "")).toEqual({ ok: false, message: "Pick the teams to bind." });
    expect(await bindTeams(deps(), fay, [b1, "999999"], "")).toEqual({
      ok: false,
      message: "A team was removed. Reload the page.",
    });
    expect(await bindTeams(deps(), fay, [b1, g1], "x".repeat(81))).toMatchObject({ ok: false });
    const bound = await bindTeams(deps(), fay, [b1, g1, b1], "  Same   family ");
    expect(bound).toMatchObject({ ok: true });
    const list = await listBindings(deps(), fay);
    expect(list).toEqual([
      expect.objectContaining({
        reason: "Same family",
        setBy: "Fay X",
        teams: [
          { id: b1, name: "Baylor 4B" },
          { id: g1, name: "Baylor 4G" },
        ],
      }),
    ]);
    expect(await listBindings(deps(), pat)).toBeNull();
    // On each team as a "coach" named by its reason, so the Scheduler links them.
    const day = () => gameDaySchedule(deps(), fay).then((s) => s!.days[0].programs[0]);
    expect((await day()).teams.find((t) => t.teamId === g1)!.coaches).toContainEqual({
      key: `b:${list![0].id}`,
      name: "Same family",
      head: false,
    });
    expect(await createDayMatchups(deps(), fay, "2027-01-09")).toMatchObject({ ok: true, created: 2 });
    const m = (await day()).matchups;
    const isHome = (t: string) => m.some((x) => (x.a === t && x.home === "a") || (x.b === t && x.home === "b"));
    expect(isHome(b1)).toBe(isHome(g1));
    // Grid: bound teams never play at the same time.
    const gym = await db.pool.query<{ id: string }>(
      "insert into partner_gyms (partner_id, name, created_by) values ($1, 'Main Gym', 't') returning id::text",
      [baylor],
    );
    const courts = (
      await db.pool.query<{ id: string }>(
        "insert into partner_courts (gym_id, name, created_by) values ($1, 'Court 1', 't'), ($1, 'Court 2', 't') returning id::text",
        [gym.rows[0].id],
      )
    ).rows.map((r) => r.id);
    await db.pool.query(
      `insert into court_hours (court_id, game_day_id, starts, ends, set_by)
       select c, g.id, '09:00', '12:00', 't' from unnest($1::bigint[]) c, game_days g where g.day = '2027-01-09'`,
      [courts],
    );
    const gameOf = (t: string) => m.find((x) => x.a === t || x.b === t)!.id;
    expect(await placeGame(deps(), fay, gameOf(b1), { court: courts[0], starts: "09:00" })).toEqual({ ok: true });
    expect(await placeGame(deps(), fay, gameOf(g1), { court: courts[1], starts: "09:00" })).toEqual({
      ok: false,
      message: "A team bound to this game (Same family) already plays then: bound teams never play at the same time.",
    });
    // Unbind: Schedulers only; then they're free again.
    expect(await unbind(deps(), pat, list![0].id)).toMatchObject({ ok: false });
    expect(await unbind(deps(), fay, list![0].id)).toEqual({ ok: true });
    expect(await unbind(deps(), fay, list![0].id)).toEqual({ ok: false, message: "That binding was already removed." });
    expect(await listBindings(deps(), fay)).toEqual([]);
    expect(await placeGame(deps(), fay, gameOf(g1), { court: courts[1], starts: "09:00" })).toEqual({ ok: true });
  });

  it("the Scheduler creates a division's matchups, keeping pairs new across Game Days", async () => {
    const id = await newLeague();
    await saveProgramDates(deps(), dee, id, { add: ["2027-01-09", "2027-01-16"], addBrackets: [], remove: [] });
    await div(id, "Boys", 3, 4, ["COMP"]);
    const divisionId = (await getProgram(deps(), dee, id))!.divisionList[0].id;
    const teams: string[] = [];
    for (const [who, forWhom, name] of [
      [pat, baylor, "Baylor A"],
      [pat, baylor, "Baylor B"],
      [sam, "solo", "Sam A"],
      [sam, "solo", "Sam B"],
    ] as const) {
      const t = await team(who, forWhom, name, "Boys", "4", "COMP");
      expect(await registerTeam(deps(), who, id, t, ALL)).toMatchObject({ ok: true });
      teams.push(t);
    }
    expect(await createMatchups(deps(), fay, id, "2027-01-09", divisionId)).toEqual({
      ok: false,
      message: "Only a Scenic City Admin or Director of Scheduling can do that.",
    });
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'scenic-city', 'scheduling', 'test')",
    );
    expect(await createMatchups(deps(), fay, id, "2027-01-10", divisionId)).toMatchObject({ ok: false });
    expect(await createMatchups(deps(), fay, id, "2027-01-09", divisionId)).toEqual({
      ok: true,
      created: 2,
      short: [],
      repeats: [],
      tbd: [],
    });
    expect(await createMatchups(deps(), fay, id, "2027-01-16", divisionId)).toEqual({
      ok: true,
      created: 2,
      short: [],
      repeats: [],
      tbd: [],
    });
    const names = new Map([
      [teams[0], "Baylor A"],
      [teams[1], "Baylor B"],
      [teams[2], "Sam A"],
      [teams[3], "Sam B"],
    ]);
    const games = async (day: string) =>
      (await gameDaySchedule(deps(), fay))!.days
        .find((d) => d.date === day)!
        .programs[0].matchups.map((m) => [names.get(m.a), m.b ? names.get(m.b) : "TBD"].sort().join(" vs "))
        .sort();
    const jan9 = await games("2027-01-09");
    const jan16 = await games("2027-01-16");
    // Teams from another club first; a pair from Jan 9 isn't repeated on Jan 16.
    expect(jan9.every((g) => g.includes("Baylor") && g.includes("Sam"))).toBe(true);
    expect(jan16.filter((g) => jan9.includes(g))).toEqual([]);
    // Home and away: each club has one of its two games at home on Jan 9.
    const homes = async (day: string) =>
      Object.fromEntries(
        (await gameDaySchedule(deps(), fay))!.days
          .find((x) => x.date === day)!
          .programs[0].matchups.flatMap((m) => [
            [names.get(m.a), m.home === "a"],
            [names.get(m.b!), m.home === "b"],
          ]),
      );
    const h9 = await homes("2027-01-09");
    const h16 = await homes("2027-01-16");
    expect([h9["Baylor A"], h9["Baylor B"]].filter(Boolean)).toHaveLength(1);
    expect([h9["Sam A"], h9["Sam B"]].filter(Boolean)).toHaveLength(1);
    // Each Jan 16 game whose teams were one home and one away on Jan 9 swaps them (two teams both home on Jan 9 can't).
    const pairs16 = (await gameDaySchedule(deps(), fay))!.days[1].programs[0].matchups.map((m) => [
      names.get(m.a)!,
      names.get(m.b!)!,
    ]);
    for (const [x, y] of pairs16) if (h9[x] !== h9[y]) expect([h16[x], h16[y]]).toEqual([!h9[x], !h9[y]]);
    // Two teams both home (or both away) on Jan 9: one of them swaps.
    for (const [x, y] of pairs16) if (h9[x] === h9[y]) expect(h16[x]).toBe(!h16[y]);
    // Creating again replaces that day's matchups; a team taken out isn't paired. The team left over plays TBD.
    await setTeamOff(deps(), fay, id, teams[3], "2027-01-16", true);
    const again = await createMatchups(deps(), fay, id, "2027-01-16", divisionId);
    expect(again).toMatchObject({ ok: true, created: 2, short: [], tbd: [expect.stringMatching(/ plays TBD$/)] });
    expect((await games("2027-01-16")).some((g) => g.includes("Sam B"))).toBe(false);
    expect((await games("2027-01-16")).filter((g) => g.includes("TBD"))).toHaveLength(1);

    // Rearranged by hand (drag and drop): checked again on the server, then saved as given.
    const save = (g: unknown) => saveMatchups(deps(), fay, id, "2027-01-09", divisionId, g);
    const [a, b, c, d] = teams;
    expect(await saveMatchups(deps(), dee, id, "2027-01-09", divisionId, [[a, b]])).toMatchObject({ ok: false });
    expect(await save([[a, a]])).toEqual({ ok: false, message: "Baylor A can't play itself." });
    expect(
      await save([
        [a, b],
        [b, a],
      ]),
    ).toEqual({ ok: false, message: "Baylor B vs Baylor A is in there twice." });
    expect(
      await save([
        [a, b],
        [a, c],
      ]),
    ).toEqual({ ok: false, message: "Baylor A is guaranteed 1 game that day; take it out of one." });
    expect(await save([[a, "999999"]])).toMatchObject({ ok: false });
    expect(await save([[a, b]])).toEqual({ ok: true, saved: 1 }); // Sam A and Sam B left in the Sandbox
    expect(await games("2027-01-09")).toEqual(["Baylor A vs Baylor B"]);
    // A game with one team plays TBD (by hand: once a day per team).
    expect(
      await save([
        [a, b],
        [c, null],
      ]),
    ).toEqual({ ok: true, saved: 2 });
    expect(await games("2027-01-09")).toEqual(["Baylor A vs Baylor B", "Sam A vs TBD"]);
    expect(
      await save([
        [c, null],
        [c, null],
      ]),
    ).toEqual({ ok: false, message: "Sam A plays TBD twice." });
    expect(
      await save([
        [c, a],
        [d, b],
      ]),
    ).toEqual({ ok: true, saved: 2 });
    expect(await games("2027-01-09")).toEqual(["Baylor A vs Sam A", "Baylor B vs Sam B"]);
    // Teams tab: each team's matchups by date, across the League's Game Days (the same list on every day's tab).
    const s = (await gameDaySchedule(deps(), fay))!;
    const list = (i: number, id: string) =>
      s.days[i].programs[0].teamGames[id].map((g) => `${g.date} ${g.opponent} ${g.opponentGroup}`);
    expect(list(0, a)[0]).toBe("2027-01-09 Sam A 4th COMP");
    expect(list(0, c)[0]).toBe("2027-01-09 Baylor A 4th COMP");
    expect(list(1, a)).toEqual(list(0, a));
    expect([...list(0, a)].sort()).toEqual(list(0, a));

    // Grid: drag games into game slots at a gym open that day.
    const gym = await db.pool.query<{ id: string }>(
      `insert into partner_gyms (partner_id, name, created_by) values ($1, 'Main Gym', 't') returning id::text`,
      [baylor],
    );
    const court = (
      await db.pool.query<{ id: string }>(
        `insert into partner_courts (gym_id, name, created_by) values ($1, 'Court 1', 't') returning id::text`,
        [gym.rows[0].id],
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into court_hours (court_id, game_day_id, starts, ends, set_by) select $1, id, '09:00', '12:00', 't' from game_days where day = '2027-01-09'`,
      [court],
    );
    const jan9Games = s.days[0].programs[0].matchups;
    const [g1, g2] = jan9Games.map((m) => m.id);
    expect(await placeGame(deps(), dee, g1, { court, starts: "09:00" })).toMatchObject({ ok: false }); // not a Scheduler
    expect(await placeGame(deps(), fay, g1, { court, starts: "11:30" })).toEqual({
      ok: false,
      message: "Main Gym Court 1 is open 9:00 AM–12:00 PM; a game doesn't fit then.",
    });
    expect(await placeGame(deps(), fay, g1, { court: "999", starts: "09:00" })).toMatchObject({ ok: false });
    // Facilities → Courts: a court approved only for other divisions refuses this division's games.
    await div(id, "Girls", 3, 4, ["COMP"]);
    const girls = (await getProgram(deps(), dee, id))!.divisionList.find((x) => x.gender === "Girls")!.id;
    expect(await setCourtDivisions(deps(), dee, court, [girls])).toMatchObject({ ok: false }); // not Facilities
    expect(await setCourtDivisions(deps(), fay, "bad", [girls])).toEqual({ ok: false, message: "Pick a court." });
    expect(await setCourtDivisions(deps(), fay, court, ["999"])).toEqual({
      ok: false,
      message: "A division isn't in a current League.",
    });
    expect(await setCourtDivisions(deps(), fay, court, [girls])).toEqual({ ok: true, divisions: 1 });
    expect(await placeGame(deps(), fay, g1, { court, starts: "09:00" })).toEqual({
      ok: false,
      message: "Main Gym Court 1 isn't approved for this division (Facilities → Courts).",
    });
    expect(await setCourtDivisions(deps(), fay, court, [girls, divisionId])).toEqual({ ok: true, divisions: 2 });
    const listed = (await listCourts(deps(), fay))!.gyms.flatMap((g) => g.courts).find((c) => c.key === court)!;
    expect([...listed.divisions].sort()).toEqual([girls, divisionId].sort());
    expect(listed.setBy).toBe("Fay X");
    expect(await placeGame(deps(), fay, g1, { court, starts: "09:00" })).toEqual({ ok: true });
    expect(await placeGame(deps(), fay, g2, { court, starts: "09:00" })).toEqual({
      ok: false,
      message: "That slot already has a game. Move that game first.",
    });
    expect(await placeGame(deps(), fay, g2, { court, starts: "09:55" })).toEqual({ ok: true });
    const placed = async () =>
      Object.fromEntries(
        (await gameDaySchedule(deps(), fay))!.days[0].programs[0].matchups.map((m) => [
          [names.get(m.a), m.b ? names.get(m.b) : "TBD"].sort().join(" vs "),
          m.starts,
        ]),
      );
    expect(await placed()).toEqual({ "Baylor A vs Sam A": "09:00", "Baylor B vs Sam B": "09:55" });
    // Saving the division again keeps each pair in its slot; a new pair starts off the grid.
    expect(
      await save([
        [a, c],
        [b, d],
      ]),
    ).toEqual({ ok: true, saved: 2 });
    expect(await placed()).toEqual({ "Baylor A vs Sam A": "09:00", "Baylor B vs Sam B": "09:55" });
    expect(
      await save([
        [a, d],
        [b, c],
      ]),
    ).toEqual({ ok: true, saved: 2 });
    expect(await placed()).toEqual({ "Baylor A vs Sam B": null, "Baylor B vs Sam A": null });
    // A team can't play two games at once.
    const [h1, h2] = (await gameDaySchedule(deps(), fay))!.days[0].programs[0].matchups.map((m) => m.id);
    expect(await placeGame(deps(), fay, h1, { court, starts: "09:00" })).toEqual({ ok: true });
    expect(await placeGame(deps(), fay, h1, null)).toEqual({ ok: true }); // back off the grid
    expect(await placeGame(deps(), fay, h2, { court, starts: "09:00" })).toEqual({ ok: true });
    // On the team's card: its games by date with the opponent, and the gym, court and time once placed.
    const placedGame = (await gameDaySchedule(deps(), fay))!.days[0].programs[0].matchups.find((m) => m.id === h2)!;
    const mine = (await scheduledGames(db.pool, [placedGame.a]))[placedGame.a];
    expect(mine.find((g) => g.date === "2027-01-09")).toMatchObject({
      program: "Winter League 2027",
      opponent: names.get(placedGame.b!),
      opponentGroup: "4th COMP",
      gym: "Main Gym",
      court: "Court 1",
      starts: "09:00",
    });
    expect(mine.find((g) => g.date === "2027-01-16")).toMatchObject({ gym: null, starts: null });
    // Changing the game length moves placed games with their blocks (the 2nd game stays the 2nd); one that no longer
    // fits before the court closes comes off the grid.
    expect(await placeGame(deps(), fay, h1, { court, starts: "09:55" })).toEqual({ ok: true });
    const times = async () =>
      Object.fromEntries((await gameDaySchedule(deps(), fay))!.days[0].programs[0].matchups.map((m) => [m.id, m.starts]));
    expect(await setGameLength(deps(), fay, "2027-01-09", 60)).toEqual({ ok: true, moved: 2, off: [] });
    expect(await times()).toEqual({ [h2]: "09:00", [h1]: "10:00" });
    expect(await setGameLength(deps(), fay, "2027-01-09", 90)).toEqual({ ok: true, moved: 2, off: [] });
    expect(await times()).toEqual({ [h2]: "09:00", [h1]: "10:30" });
    const r = await setGameLength(deps(), fay, "2027-01-09", 120);
    expect(r).toMatchObject({ ok: true, moved: 1 });
    expect(await times()).toEqual({ [h2]: "09:00", [h1]: null });
  }, 60_000);
});
