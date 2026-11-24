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
import { addDivision, getProgram, savePriceGroup, saveProgram, saveProgramDates, setPaid, setTeamOff, tagOrgs } from "./scenic-programs";
import { undoRegisterAll } from "./register-batches";
import { deleteOrganization } from "./org-delete";
import { listScenicTeams, updateScenicTeam } from "./scenic-teams";
import { addLeagueDates } from "./league-dates";
import { createTestDb, grant } from "./testing/db";
import { SCHEDULED_REFUSAL } from "./team-guards";

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
  }, 180_000);
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
    await createOrganization(deps(), jo, { ...input, features: ["court-club"] }, null);
    // CourtSync with its own teams: REC is open to it (lib/rec-orgs.ts).
    await db.pool.query(
      "insert into org_features (org, feature, source, turned_on_by) select slug, 'court-sync', 'setup', 'test' from organizations where slug not in ('thunder', 'scenic-city') on conflict do nothing",
    );
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
    expect((await listScenicTeams(deps(), dee, "Director"))!.teams[0]).toMatchObject({ name: "4B East Ridge TBD", coachId: null }); // the league name: the same as its own
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
      "4B East Ridge Coach East Ridge Parks & Rec false",
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
    expect(JSON.stringify(await getProgram(deps(), dee, pid))).toContain("4B East Ridge Coach");

    // Withdraw while open; not after it closes.
    expect(await withdrawOrgTeam(deps(), jo, org, tid, pid)).toEqual({ ok: true });
    // Not registered anywhere now: not on Scenic City's Teams (its copy stays, unlisted).
    expect((await listScenicTeams(deps(), dee, "Director"))!.teams).toEqual([]);
    expect(await registerOrgTeam(deps(), jo, org, tid, pid, ALL)).toMatchObject({ ok: true });
    // On the schedule (in a matchup): it can't withdraw; it requests removal instead.
    await db.pool.query(
      `insert into scenic_matchups (program_id, division_id, day, team_a, created_by)
       select r.program_id, d.id, '2027-01-09', r.team_id, 't' from scenic_registrations r
         join scenic_divisions d on d.program_id = r.program_id where r.program_id = $1 limit 1`,
      [pid],
    );
    expect(await withdrawOrgTeam(deps(), jo, org, tid, pid)).toEqual({ ok: false, message: SCHEDULED_REFUSAL });
    await db.pool.query("delete from scenic_matchups");
    now = new Date("2026-12-20T15:00:00Z");
    expect(await withdrawOrgTeam(deps(), jo, org, tid, pid)).toMatchObject({ ok: false });
    expect(await registerOrgTeam(deps(), jo, org, tid, pid, ALL)).toMatchObject({ ok: false });

    // After the program ends, the registration was for it: no longer on Scenic City's Teams (still the organization's).
    now = new Date("2027-03-07T15:00:00Z");
    expect((await listScenicTeams(deps(), dee, "Director"))!.teams).toEqual([]);
    // Looking back: picking the ended program still lists it (and its division); an organization's team is never "Not registered".
    const back = (await listScenicTeams(deps(), dee, "Director", pid))!;
    expect(back.teams.map((t) => [t.name, t.divisionLow, t.divisionHigh])).toEqual([["4B East Ridge Coach", 3, 4]]);
    expect(back.programs).toEqual([{ id: pid, name: "Winter League 2027", ended: true }]);
    expect((await listScenicTeams(deps(), dee, "Director", "none"))!.teams).toEqual([]);
    now = new Date("2026-12-20T15:00:00Z");
    expect((await listScenicTeams(deps(), dee, "Director"))!.teams).toHaveLength(1);

    // On the schedule: it can't be deleted (it asks the Scheduler first).
    await db.pool.query(
      `insert into scenic_matchups (program_id, division_id, day, team_a, created_by)
       select r.program_id, d.id, '2027-01-09', r.team_id, 't' from scenic_registrations r
         join scenic_divisions d on d.program_id = r.program_id where r.program_id = $1 limit 1`,
      [pid],
    );
    expect(await deleteOrgTeam(deps(), jo, org, tid)).toEqual({
      ok: false,
      message: "It's on the schedule for Winter League 2027. Request removal from the schedule (the Scheduler puts TBD in its games), then delete it.",
    });
    await db.pool.query("delete from scenic_matchups");
    // Only registered: deleting withdraws it, and takes it out of Scenic City too.
    expect(await deleteOrgTeam(deps(), jo, org, tid)).toEqual({ ok: true });
    expect((await listScenicTeams(deps(), dee, "Director"))!.teams).toEqual([]);
  });

  it("a CourtCaptain Admin deletes an organization with its teams and their League registrations; not with games", async () => {
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
    const add = async () => ((await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: ["4"], level: "REC" })) as { id: string }).id;
    const [t1, t2] = [await add(), await add()];
    expect(await registerOrgTeam(deps(), jo, org, t1, pid, ALL)).toMatchObject({ ok: true });
    expect(await registerOrgTeam(deps(), jo, org, t2, pid, ALL)).toMatchObject({ ok: true });
    const copies = (
      await db.pool.query<{ id: string }>("select id::text from scenic_teams where org_team_id = any($1::bigint[]) order by id", [[t1, t2]])
    ).rows.map((r) => r.id);
    expect(copies).toHaveLength(2);

    // Its Owner (with no teams) or a CourtCaptain Admin; the name typed exactly; never Thunder or Scenic City.
    expect(await deleteOrganization(deps(), dee, org, "East Ridge Parks & Rec")).toEqual({
      ok: false,
      message: "Only the organization's Owner can delete it.",
    });
    expect(await deleteOrganization(deps(), jo, org, "East Ridge Parks & Rec")).toEqual({
      ok: false,
      message: "East Ridge Parks & Rec still has 2 teams. Delete them on its Teams page first.",
    });
    await db.pool.query("insert into platform_admins (coach_id, granted_by) values ('9913694', 'test')");
    expect(await deleteOrganization(deps(), dee, org, "East Ridge")).toMatchObject({ ok: false, message: expect.stringContaining("Type") });
    expect(await deleteOrganization(deps(), dee, "thunder", "Thunder Basketball")).toMatchObject({ ok: false });

    // With a League game: refused, nothing removed.
    const div = (await db.pool.query<{ id: string }>("select id::text from scenic_divisions where program_id = $1", [pid])).rows[0].id;
    await db.pool.query(
      "insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by) values ($1, $2, '2027-01-09', $3, $4, 'x')",
      [pid, div, copies[0], copies[1]],
    );
    expect(await deleteOrganization(deps(), dee, org, "east ridge parks & rec")).toMatchObject({
      ok: false,
      message: expect.stringContaining("1 League game"),
    });
    expect((await db.pool.query("select 1 from organizations where slug = $1", [org])).rowCount).toBe(1);

    // Without it: the organization, its teams, their copies and registrations, roles and listing are gone; logins stay.
    await db.pool.query("delete from scenic_matchups");
    expect(await deleteOrganization(deps(), dee, org, " East Ridge Parks & Rec ")).toEqual({ ok: true, teams: 2 });
    const left = async (sql: string, v: unknown[]) => (await db.pool.query(sql, v)).rowCount;
    expect(await left("select 1 from organizations where slug = $1", [org])).toBe(0);
    expect(await left("select 1 from org_teams where org = $1", [org])).toBe(0);
    expect(await left("select 1 from scenic_teams where id = any($1::bigint[])", [copies])).toBe(0);
    expect(await left("select 1 from scenic_registrations where program_id = $1", [pid])).toBe(0);
    expect(await left("select 1 from org_roles where org = $1", [org])).toBe(0);
    expect(await left("select 1 from partners where org_slug = $1", [org])).toBe(0);
    expect(await left("select 1 from users where coach_id = '5550001'", [])).toBe(1);

    // An Owner deletes their own organization once it has no teams.
    const mine = (await createOrganization(deps(), jo, { name: "Jo Hoops", short: "Jo Hoops", kind: "Organization", color: "#0f766e", features: ["court-club"] }, null)) as {
      slug: string;
    };
    expect(await deleteOrganization(deps(), jo, mine.slug, "Jo Hoops")).toEqual({ ok: true, teams: 0 });
    expect(await left("select 1 from organizations where slug = $1", [mine.slug])).toBe(0);
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
    expect(d.groups[0].pools[0].teams.map((t) => t.name)).toEqual(["PKC East Ridge TBD"]);
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
      // Named from its Head Coach (Cy <name>): "4B East Ridge Bolts"; with none yet, "4B East Ridge TBD".
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
        "3B East Ridge Comets: Boys 3rd–4th · 3rd COMP · Pool A",
        "4B East Ridge TBD: Boys 3rd–4th · 4th REC · Pool A",
        "5G East Ridge Rockets: Girls 5th–6th · 5th REC · Pool A",
      ],
      skipped: ["7G East Ridge Stars: This program has no Girls 7th REC."],
    };
    // The confirmation first: what it would do (each team's division and dates), nothing registered yet.
    const preview = await registerAllOrgTeams(deps(), jo, org, pid, true);
    expect(preview).toMatchObject({ ...plan, batchId: null });
    expect(preview.ok && preview.teams[0]).toMatchObject({ name: "3B East Ridge Comets", division: "Boys 3rd–4th · 3rd COMP · Pool A" });
    expect((await orgPrograms(deps(), jo, org))!.programs).toMatchObject([{ registered: 1, unregistered: 4, lastBatch: null }]);
    const done = await registerAllOrgTeams(deps(), jo, org, pid);
    expect(done).toMatchObject(plan);
    const batchId = done.ok ? done.batchId! : "";
    expect((await orgPrograms(deps(), jo, org))!.programs).toMatchObject([
      {
        registered: 4,
        unregistered: 1,
        lastBatch: { id: batchId, teams: 3, by: "Jo X", undoneAt: null, names: ["3B East Ridge Comets", "4B East Ridge TBD", "5G East Ridge Rockets"] },
      },
    ]);

    // Undo: the 3 come back out (Bolts, registered on its own, stays); a team marked paid since stays too.
    const comets = (await db.pool.query<{ id: string }>("select id::text from scenic_teams where name like '%Comets'")).rows[0].id;
    await db.pool.query("insert into org_role_types (org, role) values ('scenic-city', 'Owner') on conflict do nothing");
    await db.pool.query("select set_role('9913694', 'scenic-city', 'Owner', true, 'test')"); // only Owners mark Paid
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
    await addDivision(deps(), dee, pid, { gender: "Boys", from: 2, to: 3, levels: ["COMP", "REC"] });
    const tid = ((await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: ["2"], level: "COMP" })) as { id: string }).id;
    // Its Head Coach (not a Director): adds dates and a 2nd Game once the team is registered, never the first registration.
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550777', 'Kim', 'X', '4235550777') on conflict do nothing");
    await db.pool.query("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550777', 'HeadCoach', 't')", [tid]);
    const kim = person("5550777", "Kim");
    expect(await registerOrgTeam(deps(), kim, org, tid, pid, { allSeason: false, days: [{ date: "2026-12-05", kind: "single_1" }] })).toEqual({
      ok: false,
      message: "Your Director registers the team first; then you can add dates.",
    });
    expect(await teamPrograms(deps(), kim, org, tid)).toMatchObject({ canRegister: false, canAddDates: true });
    expect(await teamPrograms(deps(), person("5550002", "Sam"), org, tid)).toMatchObject({ canRegister: false, canAddDates: false });

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
      division: "Boys 2nd–3rd · 2nd COMP · Pool A",
      entry: { perDate: { "2026-12-05": 2 }, bracket: false, feeCents: 6000 },
    });
    // Now registered: its coach adds a date with its 2nd Game.
    const later = await registerOrgTeam(deps(), kim, org, tid, pid, {
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
    const team = (await getProgram(deps(), dee, pid))!.divisionList[0].groups.flatMap((g) => g.pools.flatMap((p) => p.teams))[0];
    expect(team).toMatchObject({ name: "2B East Ridge TBD", entry: { bracket: true, feeCents: 11500 } });

    // From its League team page (lib/league-dates): its coach, its organization's and Scenic City's directors add dates
    // or a 2nd Game; strangers can't. Nothing is added unpaid: with no card payments, it's refused (Stripe: see
    // lib/stripe/registration.test.ts) unless its organization pays later (a Pay later price group), and then a Paid
    // registration whose fee goes up turns Unpaid.
    const copy = (await db.pool.query<{ id: string }>("select id::text from scenic_teams where org_team_id = $1", [tid])).rows[0].id;
    expect(await addLeagueDates(deps(), person("5550002", "Sam"), pid, copy, { allSeason: false, days: [] })).toMatchObject({ ok: false });
    await db.pool.query("update scenic_registrations set paid = true where program_id = $1 and team_id = $2", [pid, copy]);
    expect(await addLeagueDates(deps(), kim, pid, copy, { allSeason: false, days: [{ date: "2026-12-05", kind: "single_2nd" }] })).toMatchObject({
      ok: false, // Dec 5 already has 2 games
    });
    const jan9 = { allSeason: false, days: [{ date: "2027-01-09", kind: "single_1" }] };
    expect(await addLeagueDates(deps(), dee, pid, copy, jan9)).toEqual({
      ok: false,
      message: "Card payments aren't available right now, so nothing was added. Try again later.",
    });
    const g = (await savePriceGroup(deps(), dee, pid, null, { name: "Later", allSeason: "", payLater: true })) as { id: string };
    expect(await tagOrgs(deps(), dee, pid, [org], g.id)).toEqual({ ok: true });
    expect(await addLeagueDates(deps(), dee, pid, copy, jan9)).toMatchObject({
      ok: true,
      unpaid: true,
      entry: { perDate: { "2026-12-05": 2, "2026-12-12": 2, "2027-01-09": 1 }, feeCents: 15000 },
    });
    expect(await addLeagueDates(deps(), kim, pid, copy, { allSeason: false, days: [{ date: "2027-01-09", kind: "single_2nd" }] })).toMatchObject({
      ok: true,
      unpaid: false, // it was already Unpaid
      entry: { perDate: { "2027-01-09": 2 }, feeCents: 17000 },
    });

    // A REC team: ALL Season only (nothing else offered, refused on the server).
    const rec = ((await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: ["3"], level: "REC" })) as { id: string }).id;
    await db.pool.query("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550777', 'HeadCoach', 't')", [rec]);
    const noDates = { ok: false, message: expect.stringContaining("REC teams register for ALL Season only") };
    expect(await registerOrgTeam(deps(), jo, org, rec, pid, { allSeason: false, days: [{ date: "2026-12-05", kind: "single_1" }] })).toEqual(noDates);
    expect(await registerOrgTeam(deps(), jo, org, rec, pid, { allSeason: true, days: [{ date: "2026-12-05", kind: "single_2nd" }] })).toEqual(noDates);
    const recShown = (await teamPrograms(deps(), kim, org, rec))!;
    expect(recShown).toMatchObject({ canRegister: false, canAddDates: false });
    expect(recShown.programs[0].options.filter((o) => o.kind !== "all_season")).toEqual([]);
    await db.pool.query("insert into scenic_program_options (program_id, kind, fee_cents) values ($1, 'all_season', 10000) on conflict do nothing", [pid]);
    expect(await registerOrgTeam(deps(), jo, org, rec, pid, { allSeason: true, days: [] })).toMatchObject({ ok: true });
    expect(await registerOrgTeam(deps(), kim, org, rec, pid, { allSeason: false, days: [{ date: "2026-12-12", kind: "single_1" }] })).toMatchObject({ ok: false });
    const recCopy = (await db.pool.query<{ id: string }>("select id::text from scenic_teams where org_team_id = $1", [rec])).rows[0].id;
    expect(await addLeagueDates(deps(), kim, pid, recCopy, { allSeason: false, days: [{ date: "2026-12-12", kind: "single_1" }] })).toEqual({
      ok: false,
      message: "A REC team's dates are added by its Director, Admin or Owner.",
    });
    expect(await addLeagueDates(deps(), jo, pid, recCopy, { allSeason: false, days: [{ date: "2026-12-12", kind: "single_2nd" }] })).toEqual(noDates);

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
