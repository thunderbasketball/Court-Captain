import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";

const ALL = { allSeason: true, days: [] }; // register for ALL Season
import {
  orgPrograms,
  registerAllOrgTeams,
  registerOrgTeam,
  setOrgTeamDayOff,
  teamPrograms,
  withdrawOrgTeam,
} from "./org-leagues";
import { createOrganization } from "./org-signup";
import { addOrgTeamCoach, createOrgTeam, deleteOrgTeam } from "./org-teams";
import { addDivision, getProgram, saveProgram, saveProgramDates, setPaid, setTeamOff } from "./scenic-programs";
import { undoRegisterAll } from "./register-batches";
import { listScenicTeams, updateScenicTeam } from "./scenic-teams";
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
const jo = person("5550001", "Jo"); // East Ridge Owner
const dee = person("9913694", "Dee"); // Scenic City Admin
const org = "east-ridge-parks-and-rec";

describe("an organization's teams in Scenic City programs", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  let now = new Date("2026-11-02T15:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });

  beforeEach(async () => {
    now = new Date("2026-11-02T15:00:00Z");
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('5550001', 'Jo', 'X', '4235550001'), ('9913694', 'Dee', 'X', '4239913694')`,
    );
    await grant(db.pool, "9913694 scenic-city Director", "9913694 scenic-city Admin");
    const input = { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e" };
    await createOrganization(deps(), jo, { ...input, features: ["court-org"] }, null);
  });

  it("registers a team (copy read-only in Scenic City), withdraws it", async () => {
    // A program with Boys 3rd–4th REC.
    const pid = (
      (await saveProgram(deps(), dee, null, {
        kind: "League",
        name: "Winter League 2027",
        startsOn: "2027-01-09",
        endsOn: "2027-03-06",
        regOpens: "2026-11-01",
        regCloses: "2026-12-15",
        fee: "$150",
      })) as { id: string }
    ).id;
    await addDivision(deps(), dee, pid, { gender: "Boys", from: 3, to: 4, levels: ["REC"] });
    const tid = ((await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: ["4"], level: "REC" })) as { id: string }).id;

    // No approval needed, and no coach yet: it shows "no coach" in Scenic City until one is added.
    const progs = (await teamPrograms(deps(), jo, org, tid))!;
    expect(progs).toMatchObject({
      canRegister: true,
      programs: [{ name: "Winter League 2027", status: "open", fits: true, registered: null }],
    });
    expect(await registerOrgTeam(deps(), jo, org, tid, pid, ALL)).toMatchObject({ ok: true });
    expect((await listScenicTeams(deps(), dee, "Director"))!.teams[0]).toMatchObject({ name: "ER 4B TBD", coachId: null }); // the league name: Abbreviation first
    await addOrgTeamCoach(deps(), jo, org, tid, { first: "Cy", last: "Coach", cell: "4235550003", role: "HeadCoach" });
    expect((await listScenicTeams(deps(), dee, "Director"))!.teams[0]).toMatchObject({ coachFirst: "Cy", coachLast: "Coach" });
    expect(await registerOrgTeam(deps(), jo, org, tid, pid, ALL)).toMatchObject({
      ok: false,
      message: "Already registered for ALL Season.",
    });
    expect((await teamPrograms(deps(), jo, org, tid))!.programs[0].registered).toMatchObject({
      where: "Boys 3rd–4th · 4th REC · Pool A",
      by: "Jo X",
      paid: false,
    });
    expect(await registerOrgTeam(deps(), dee, org, tid, pid, ALL)).toMatchObject({ ok: false }); // not East Ridge's

    // Scenic City sees it under East Ridge, read-only, in the program.
    const scenic = (await listScenicTeams(deps(), dee, "Director"))!;
    expect(scenic.teams.map((t) => `${t.name} ${t.partnerName} ${t.canEdit}`)).toEqual([
      "ER 4B Coach East Ridge Parks & Rec false",
    ]); // renamed with its Head Coach
    expect(scenic.addFor.map((a) => a.label)).not.toContain("East Ridge Parks & Rec");
    const copy = scenic.teams[0].id;
    expect(
      await updateScenicTeam(deps(), dee, copy, {
        name: "X",
        gender: "Boys",
        level: "REC",
        grade: "4",
        coachFirst: "Cy",
        coachLast: "Coach",
        coachCell: "4235550003",
      }),
    ).toEqual({ ok: false, message: "This team is managed by its organization." });
    expect(JSON.stringify(await getProgram(deps(), dee, pid))).toContain("ER 4B Coach");

    // Withdraw while open; not after it closes.
    expect(await withdrawOrgTeam(deps(), jo, org, tid, pid)).toEqual({ ok: true });
    expect(await registerOrgTeam(deps(), jo, org, tid, pid, ALL)).toMatchObject({ ok: true });
    now = new Date("2026-12-20T15:00:00Z");
    expect(await withdrawOrgTeam(deps(), jo, org, tid, pid)).toMatchObject({ ok: false });
    expect(await registerOrgTeam(deps(), jo, org, tid, pid, ALL)).toMatchObject({ ok: false });

    // Deleting the team takes it out of Scenic City too.
    expect(await deleteOrgTeam(deps(), jo, org, tid)).toEqual({ ok: true });
    expect((await listScenicTeams(deps(), dee, "Director"))!.teams).toEqual([]);
  });

  it("a Pre-K Coed team registers into the League's Coed Pre-K division (REC only)", async () => {
    const pid = (
      (await saveProgram(deps(), dee, null, {
        kind: "League",
        name: "Winter League 2027",
        startsOn: "2027-01-09",
        endsOn: "2027-03-06",
        regOpens: "2026-11-01",
        regCloses: "2026-12-15",
        fee: "$150",
      })) as { id: string }
    ).id;
    expect(await addDivision(deps(), dee, pid, { gender: "Coed", from: -1, to: -1, levels: ["COMP"] })).toEqual({
      ok: false,
      message: "Pre-K is REC only.",
    });
    expect(await addDivision(deps(), dee, pid, { gender: "Coed", from: 0, to: 1, levels: ["REC"] })).toMatchObject({ ok: false });
    expect(await addDivision(deps(), dee, pid, { gender: "Boys", from: -1, to: 0, levels: ["REC"] })).toMatchObject({
      ok: false,
    });
    expect(await addDivision(deps(), dee, pid, { gender: "Coed", from: -1, to: -1, levels: ["REC"] })).toEqual({
      ok: true,
      label: "Coed Pre-K",
    });
    const tid = ((await createOrgTeam(deps(), jo, org, { gender: "Coed", grades: ["PK"], level: "REC" })) as { id: string }).id;
    expect(await registerOrgTeam(deps(), jo, org, tid, pid, ALL)).toMatchObject({ ok: true });
    const d = (await getProgram(deps(), dee, pid))!.divisionList[0];
    expect(d).toMatchObject({ label: "Coed Pre-K", groups: [{ label: "Pre-K REC" }] });
    expect(d.groups[0].pools[0].teams.map((t) => t.name)).toEqual(["ER PKC TBD"]);
  });

  it("registers all unregistered teams at once, each into its division (coach or not); skips ones with no division", async () => {
    const pid = (
      (await saveProgram(deps(), dee, null, {
        kind: "League",
        name: "Winter League 2027",
        startsOn: "2027-01-09",
        endsOn: "2027-03-06",
        regOpens: "2026-11-01",
        regCloses: "2026-12-15",
        fee: "$150",
      })) as { id: string }
    ).id;
    await addDivision(deps(), dee, pid, { gender: "Boys", from: 3, to: 4, levels: ["REC", "COMP"] });
    await addDivision(deps(), dee, pid, { gender: "Girls", from: 5, to: 6, levels: ["REC"] });
    const team = async (name: string, gender: string, grade: string, level: string, cell: string | null) => {
      // Named from its Head Coach (Cy <name>): "4B Bolts"; with none yet, "4B TBD".
      const headCoach = cell ? { first: "Cy", last: name, cell } : "none";
      return ((await createOrgTeam(deps(), jo, org, { gender, grades: [grade], level, headCoach })) as { id: string }).id;
    };
    const bolts = await team("Bolts", "Boys", "4", "REC", "4235550003");
    await team("Comets", "Boys", "3", "COMP", "4235550004");
    await team("Rockets", "Girls", "5", "REC", "4235550005");
    await team("Stars", "Girls", "7", "REC", "4235550006"); // no 7th grade division
    await team("Suns", "Boys", "4", "REC", null); // no coach yet: still registers
    await registerOrgTeam(deps(), jo, org, bolts, pid, ALL); // already in

    expect((await orgPrograms(deps(), jo, org))!.programs).toMatchObject([
      { name: "Winter League 2027", registered: 1, unregistered: 4 },
    ]);
    expect(await registerAllOrgTeams(deps(), { ...jo, coachId: "5550003" }, org, pid)).toMatchObject({ ok: false });
    const plan = {
      ok: true,
      registered: [
        "3B Comets: Boys 3rd–4th · 3rd COMP · Pool A",
        "4B TBD: Boys 3rd–4th · 4th REC · Pool A",
        "5G Rockets: Girls 5th–6th · 5th REC · Pool A",
      ],
      skipped: ["7G Stars: This program has no Girls 7th REC."],
    };
    // The confirmation first: what it would do (each team's division and dates), nothing registered yet.
    const preview = await registerAllOrgTeams(deps(), jo, org, pid, true);
    expect(preview).toMatchObject({ ...plan, batchId: null });
    expect(preview.ok && preview.teams[0]).toMatchObject({ name: "3B Comets", division: "Boys 3rd–4th · 3rd COMP · Pool A" });
    expect((await orgPrograms(deps(), jo, org))!.programs).toMatchObject([{ registered: 1, unregistered: 4, lastBatch: null }]);
    const done = await registerAllOrgTeams(deps(), jo, org, pid);
    expect(done).toMatchObject(plan);
    const batchId = done.ok ? done.batchId! : "";
    expect((await orgPrograms(deps(), jo, org))!.programs).toMatchObject([
      {
        registered: 4,
        unregistered: 1,
        lastBatch: { id: batchId, teams: 3, by: "Jo X", undoneAt: null, names: ["3B Comets", "4B TBD", "5G Rockets"] },
      },
    ]);

    // Undo: the 3 come back out (Bolts, registered on its own, stays); a team marked paid since stays too.
    const comets = (await db.pool.query<{ id: string }>("select id::text from scenic_teams where name like '%Comets'")).rows[0].id;
    expect(await setPaid(deps(), dee, pid, comets, true)).toMatchObject({ ok: true });
    expect(await undoRegisterAll(deps(), { ...jo, coachId: "5550003" }, batchId)).toMatchObject({ ok: false });
    expect(await undoRegisterAll(deps(), jo, batchId)).toEqual({ ok: true, removed: 2, kept: [expect.stringContaining("Comets")] });
    expect(await undoRegisterAll(deps(), jo, batchId)).toEqual({ ok: false, message: "That Register all was already undone." });
    expect((await orgPrograms(deps(), jo, org))!.programs).toMatchObject([
      { registered: 2, unregistered: 3, lastBatch: null }, // undone: no longer listed
    ]);
    // Uncheck teams in the confirmation: only the checked ones register (checked on the server).
    const again = await registerAllOrgTeams(deps(), jo, org, pid, true);
    const ids = again.ok ? again.teams.map((t) => t.id) : [];
    expect(ids).toHaveLength(2);
    expect(await registerAllOrgTeams(deps(), jo, org, pid, false, [])).toEqual({
      ok: false,
      message: "Check at least one team to register.",
    });
    expect(await registerAllOrgTeams(deps(), jo, org, pid, false, ["x"])).toMatchObject({ ok: false });
    expect(await registerAllOrgTeams(deps(), jo, org, pid, false, [ids[1]])).toMatchObject({
      ok: true,
      registered: [plan.registered[2]],
      skipped: [],
    });
    expect(await registerAllOrgTeams(deps(), jo, org, pid)).toMatchObject({ ok: true, registered: [plan.registered[1]] });

    now = new Date("2026-12-20T15:00:00Z");
    expect(await registerAllOrgTeams(deps(), jo, org, pid)).toEqual({
      ok: false,
      message: "Registration isn't open for this program.",
    });
  });

  it("registers Single Days, adds a 2nd Game later; each date's GG, the brackets and the fee follow", async () => {
    const pid = (
      (await saveProgram(deps(), dee, null, {
        kind: "League",
        name: "Winter (26/27)",
        startsOn: "2026-12-01",
        endsOn: "2027-02-28",
        regOpens: "2026-11-01",
        regCloses: "2026-12-31",
        fee: "",
        options: [
          { kind: "all_season", fee: "300" },
          { kind: "single_1", fee: "35" },
          { kind: "single_2nd", fee: "20" },
          { kind: "single_2", fee: "60" },
        ],
      })) as { id: string }
    ).id;
    await saveProgramDates(deps(), dee, pid, {
      add: ["2026-12-05", "2026-12-12", "2026-12-19", "2027-01-09"],
      addBrackets: ["2027-02-27"],
      remove: [],
    });
    await addDivision(deps(), dee, pid, { gender: "Boys", from: 2, to: 3, levels: ["REC"] });
    const tid = ((await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: ["2"], level: "REC" })) as { id: string }).id;

    expect(await registerOrgTeam(deps(), jo, org, tid, pid)).toMatchObject({ ok: false }); // must pick something
    expect(
      await registerOrgTeam(deps(), jo, org, tid, pid, { allSeason: false, days: [{ date: "2027-02-27", kind: "single_1" }] }),
    ).toMatchObject({
      ok: false, // a Bracket Day isn't a Game Day
    });
    const first = await registerOrgTeam(deps(), jo, org, tid, pid, {
      allSeason: false,
      days: [{ date: "2026-12-05", kind: "single_2" }],
    });
    expect(first).toMatchObject({
      ok: true,
      division: "Boys 2nd–3rd · 2nd REC · Pool A",
      entry: { perDate: { "2026-12-05": 2 }, bracket: false, feeCents: 6000 },
    });
    const later = await registerOrgTeam(deps(), jo, org, tid, pid, {
      allSeason: false,
      days: [
        { date: "2026-12-12", kind: "single_1" },
        { date: "2026-12-12", kind: "single_2nd" },
      ],
    });
    expect(later).toMatchObject({
      ok: true,
      division: null, // already in its pool
      entry: { perDate: { "2026-12-05": 2, "2026-12-12": 2 }, bracket: true, feeCents: 11500 },
    });
    const shown = (await teamPrograms(deps(), jo, org, tid))!.programs[0];
    expect(shown.entry).toMatchObject({ perDate: { "2026-12-05": 2, "2026-12-12": 2 }, bracket: true });
    const team = (await getProgram(deps(), dee, pid))!.divisionList[0].groups[0].pools[0].teams[0];
    expect(team).toMatchObject({ name: "ER 2B TBD", entry: { bracket: true, feeCents: 11500 } });

    // The team withdraws from a date and re-enters it; a date Scenic City took it out of only Scenic City restores.
    const dayOff = (what: string, out: boolean) => setOrgTeamDayOff(deps(), jo, org, tid, pid, what, out);
    expect(await dayOff("2026-12-19", true)).toEqual({ ok: false, message: "The team isn't registered for that date." });
    expect(await dayOff("2026-12-05", true)).toEqual({ ok: true });
    expect((await teamPrograms(deps(), jo, org, tid))!.programs[0].registered).toMatchObject({
      off: { "2026-12-05": "Jo X" },
      teamOff: ["2026-12-05"],
    });
    expect(await setOrgTeamDayOff(deps(), dee, org, tid, pid, "2026-12-05", false)).toMatchObject({ ok: false }); // not East Ridge's
    expect(await dayOff("2026-12-05", false)).toEqual({ ok: true });
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'scheduling', 't')",
    );
    await setTeamOff(deps(), dee, pid, team.teamId, "2026-12-12", true);
    expect(await dayOff("2026-12-12", false)).toMatchObject({ ok: false, message: /Scenic City took the team out/ });
    expect(await dayOff("brackets", true)).toEqual({ ok: true });
    now = new Date("2026-12-10T15:00:00Z");
    expect(await dayOff("2026-12-05", true)).toEqual({ ok: false, message: "That date has passed." });
  });
});
