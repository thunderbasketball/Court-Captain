import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { createOrganization } from "./org-signup";
import {
  addOrgTeamCoach,
  createOrgTeam,
  deleteOrgTeam,
  getOrgTeam,
  importTeams,
  listTeamImports,
  listOrgTeams,
  previewTeamImport,
  removeOrgTeamCoach,
  setOrgTeamAltName,
  undoTeamImport,
  setOrgHeadCoachEmail,
  setOrgWaitingCoach,
  updateOrgTeam,
} from "./org-teams";
import { addOrgPlayer, importOrgPlayers, listOrgRoster, previewPlayerImport, removeOrgPlayer } from "./org-rosters";
import { createTestDb } from "./testing/db";

const jo: SessionUser = {
  coachId: "5550001",
  firstName: "Jordan",
  lastName: "Harris",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
};
const org = "east-ridge-parks-and-rec";

describe("teams for a registered organization", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-02T15:00:00Z") });
  const hasRole = async (coachId: string, role: string) =>
    (await db.pool.query<{ ok: boolean }>("select has_role($1, $2, $3) as ok", [coachId, org, role])).rows[0].ok;

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jordan', 'Harris', '4235550001')",
    );
    const input = { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e" };
    await createOrganization(deps(), jo, { ...input, features: ["court-club"] }, null);
    // CourtSync with its own teams: REC is open to it (lib/rec-orgs.ts).
    await db.pool.query(
      "insert into org_features (org, feature, source, turned_on_by) select slug, 'court-sync', 'setup', 'test' from organizations where slug not in ('thunder', 'scenic-city') on conflict do nothing",
    );
  });

  it("REC needs CourtSync, then an invitation to a current League's REC (or REC open to all); COMP always", async () => {
    const add = (level: string) =>
      createOrgTeam(deps(), jo, org, { level, gender: "Boys", grades: ["4"], headCoach: "none" } as Parameters<typeof createOrgTeam>[3]);
    // No CourtSync: no REC.
    await db.pool.query("delete from org_features where org = $1 and feature = 'court-sync'", [org]);
    expect(await add("REC")).toMatchObject({ ok: false, message: expect.stringContaining("CourtSync") });
    expect(await add("COMP")).toMatchObject({ ok: true });
    await db.pool.query("insert into org_features (org, feature, source, turned_on_by) values ($1, 'court-sync', 'setup', 'test')", [org]);
    // CourtSync and no current League: nothing more limits it.
    expect(await add("REC")).toMatchObject({ ok: true });
    const p = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2026-11-30', 'x', 'x') returning id::text`,
      )
    ).rows[0].id;
    // A current League with REC open to everyone: still fine.
    expect(await add("REC")).toMatchObject({ ok: true });
    // REC limited to other organizations: COMP only, here and in an import.
    await db.pool.query("update scenic_programs set rec_limited_by = 'x' where id = $1", [p]);
    expect(await add("REC")).toMatchObject({ ok: false, message: expect.stringContaining("REC is only for organizations") });
    expect(await add("COMP")).toMatchObject({ ok: true });
    const preview = await previewTeamImport(deps(), jo, org, "Gender,Grade,Level\nGirls,5th,REC\nGirls,5th,COMP");
    expect(preview.ok && preview.rows.map((r) => r.status)).toEqual(["error", "new"]);
    // Picked for REC: open again.
    const partner = (
      await db.pool.query<{ id: string }>(
        `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug)
         values ('East Ridge', 'Organization', false, true, true, 'x', $1) returning id::text`,
        [org],
      )
    ).rows[0].id;
    await db.pool.query("insert into scenic_program_rec_partners (program_id, partner_id, added_by) values ($1, $2, 'x')", [p, partner]);
    expect(await add("REC")).toMatchObject({ ok: true });
    // Once that League has ended, no current League limits it.
    await db.pool.query("delete from scenic_program_rec_partners");
    await db.pool.query(
      "update scenic_programs set reg_opens = '2026-08-01', reg_closes = '2026-08-30', starts_on = '2026-09-01', ends_on = '2026-10-01' where id = $1",
      [p],
    );
    expect(await add("REC")).toMatchObject({ ok: true });
  });

  it("Edit team: gender, grades and level change (renamed by the rule, its League copy too); REC rules; not while in a League", async () => {
    const made = (await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: ["4"], level: "COMP", headCoach: "none" } as Parameters<
      typeof createOrgTeam
    >[3])) as { id: string; name: string };
    expect(made.name).toBe("4B East Ridge TBD");
    const edit = (input: object, who = jo) => updateOrgTeam(deps(), who, org, made.id, { gender: "Boys", grades: ["4"], level: "COMP", ...input });
    // Only its Admins and Directors of Teams; checked.
    const sam = { ...jo, coachId: "5550009", firstName: "Sam" };
    expect(await edit({ level: "REC" }, sam)).toMatchObject({ ok: false });
    expect(await edit({ grades: ["4", "6"] })).toMatchObject({ ok: false });
    expect(await edit({ level: "Varsity" })).toMatchObject({ ok: false });
    // COMP → REC, then grades: renamed, who changed it recorded; its League copy follows.
    await db.pool.query(
      `insert into scenic_teams (name, gender, grade_low, grade, level, coach_id, created_by, updated_by, org_team_id, owner_coach_id)
       values ('ER 4B East Ridge TBD', 'Boys', 4, 4, 'COMP', null, 't', 't', $1, '5550001')`,
      [made.id],
    );
    expect(await edit({ level: "REC" })).toEqual({ ok: true, name: "4B East Ridge TBD" });
    expect(await edit({ level: "REC", grades: ["5", "4"] })).toEqual({ ok: true, name: "5B East Ridge TBD" });
    const t = (await getOrgTeam(deps(), jo, org, made.id))!.team;
    expect(t).toMatchObject({ level: "REC", grades: ["4", "5"], changedBy: "Jordan Harris" });
    expect((await db.pool.query("select level, grade_low, grade from scenic_teams where org_team_id = $1", [made.id])).rows[0]).toEqual({
      level: "REC",
      grade_low: 4,
      grade: 5,
    });
    // REC limited to other organizations by a current League: back to COMP is fine, REC isn't.
    const p = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by, rec_limited_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2026-11-30', 'x', 'x', 'x') returning id::text`,
      )
    ).rows[0].id;
    expect(await edit({ level: "COMP", grades: ["4", "5"] })).toMatchObject({ ok: true });
    expect(await edit({ level: "REC", grades: ["4", "5"] })).toMatchObject({ ok: false, message: expect.stringContaining("REC is only") });
    // Registered in that League: no change until it's withdrawn.
    await db.pool.query(
      `insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Boys', 4, 5);
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;`.replace("$1", p),
    );
    await db.pool.query(
      "insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select $1, id, (select id from scenic_pools), 't' from scenic_teams where org_team_id = $2",
      [p, made.id],
    );
    expect(await edit({ level: "COMP", grades: ["5"] })).toMatchObject({ ok: false, message: expect.stringContaining("Withdraw it from Winter first") });
    await db.pool.query("update scenic_registrations set removed_by = 'x'");
    expect(await edit({ level: "COMP", grades: ["5"] })).toEqual({ ok: true, name: "5B East Ridge TBD" });
  });

  it("teams are named Grade + Gender + Head Coach (TBD until one), numbered when the same; renamed when the Head Coach changes", async () => {
    const add = (input: Record<string, unknown>) =>
      createOrgTeam(deps(), jo, org, { level: "REC", headCoach: "none", ...input } as Parameters<typeof createOrgTeam>[3]);
    expect(await add({ gender: "Girls", grades: ["5"] })).toMatchObject({ ok: true, name: "5G East Ridge TBD" });
    expect(await add({ gender: "Girls", grades: ["5"] })).toMatchObject({ ok: true, name: "5G East Ridge TBD 2" }); // the 1st is "5G East Ridge TBD 1"
    // Pre-K (ages 3 and 4, for Scenic City Leagues): Coed and REC, on its own.
    expect(await add({ gender: "Coed", grades: ["PK"] })).toMatchObject({ ok: true, name: "PKC East Ridge TBD" });
    expect(await add({ gender: "Boys", grades: ["PK"] })).toEqual({ ok: false, message: "Pre-K teams are Coed." });
    expect(await add({ gender: "Coed", grades: ["3"] })).toEqual({
      ok: false,
      message: "Only Pre-K teams are Coed; pick Boys or Girls.",
    });
    expect(await add({ gender: "Coed", grades: ["PK"], level: "COMP" })).toEqual({ ok: false, message: "Pre-K teams are REC." });
    expect(await add({ gender: "Coed", grades: ["PK", "K"] })).toMatchObject({ ok: false });
    const b = await add({
      gender: "Boys",
      grades: ["4", "3"],
      level: "COMP",
      headCoach: { first: "Sam", last: "Lee", cell: "(423) 555-0009" },
      altName: "Bolts",
    });
    expect(b).toMatchObject({ ok: true, name: "4B Bolts Lee" });
    const id = (b as { id: string }).id;
    expect(await hasRole("5550009", "Coach")).toBe(true); // login made, Coach role here
    // The same name again numbers both; when one goes, the other drops its number.
    const again = await add({ gender: "Boys", grades: ["4"], headCoach: "user:5550009", altName: "Bolts" });
    expect(again).toMatchObject({ ok: true, name: "4B Bolts Lee 2" });
    expect((await getOrgTeam(deps(), jo, org, id))!.team.name).toBe("4B Bolts Lee 1");
    expect(await deleteOrgTeam(deps(), jo, org, (again as { id: string }).id)).toEqual({ ok: true });
    expect((await getOrgTeam(deps(), jo, org, id))!.team.name).toBe("4B Bolts Lee");
    expect(await add({ gender: "Boys", grades: ["4", "6"] })).toMatchObject({ ok: false }); // not next to each other
    expect(await add({ gender: "Boys", grades: ["4"], altName: "=cmd" })).toMatchObject({ ok: false });

    // An Assistant Coach doesn't change the name; a Head Coach does, and removing them makes it TBD again.
    const coach = { first: "Pat", last: "Lee", cell: "4235550008", role: "AsstCoach" };
    expect(await addOrgTeamCoach(deps(), jo, org, id, coach)).toMatchObject({ ok: true });
    expect(await addOrgTeamCoach(deps(), jo, org, id, { ...coach, role: "HeadCoach" })).toMatchObject({
      ok: false,
      message: "This team already has a Head Coach. Remove them first.",
    });
    const tbd = (await listOrgTeams(deps(), jo, org))!.teams.find((t) => t.name === "5G East Ridge TBD 1")!.id;
    expect(
      await addOrgTeamCoach(deps(), jo, org, tbd, { first: "Ann", last: "Kim", cell: "4235550021", role: "HeadCoach" }),
    ).toMatchObject({ ok: true });
    const list = (await listOrgTeams(deps(), jo, org))!;
    expect(list.canManage).toBe(true);
    expect(list.teams.map((t) => `${t.gender} ${t.grade} ${t.level} ${t.name}${t.altName ? ` · ${t.altName}` : ""}`)).toEqual([
      "Coed Pre-K REC PKC East Ridge TBD",
      "Boys 3rd/4th COMP 4B Bolts Lee · Bolts",
      "Girls 5th REC 5G East Ridge Kim",
      "Girls 5th REC 5G East Ridge TBD", // left alone, it dropped its number
    ]);
    expect(list.teams.find((t) => t.name === "4B Bolts Lee")!.coaches.map((c) => `${c.name} ${c.role} by ${c.addedBy}`)).toEqual([
      "Sam Lee HeadCoach by Jordan Harris",
      "Pat Lee AsstCoach by Jordan Harris",
    ]);
    expect(await removeOrgTeamCoach(deps(), jo, org, tbd, "5550021")).toEqual({ ok: true });
    expect((await getOrgTeam(deps(), jo, org, tbd))!.team.name).toBe("5G East Ridge TBD 2");
    // An Alternate name goes in the name, in place of the organization's (and comes out again when removed).
    expect(await setOrgTeamAltName(deps(), jo, org, tbd, "Rockets")).toEqual({ ok: true, name: "5G Rockets TBD" });
    expect((await getOrgTeam(deps(), jo, org, tbd))!.team).toMatchObject({ altName: "Rockets", name: "5G Rockets TBD" });
    expect(await setOrgTeamAltName(deps(), jo, org, tbd, "")).toEqual({ ok: true, name: "5G East Ridge TBD 2" });
    expect(await setOrgTeamAltName(deps(), jo, org, tbd, "Rockets")).toEqual({ ok: true, name: "5G Rockets TBD" });

    // A coach sees only their teams, and can't change them.
    const sam = { ...jo, coachId: "5550009", firstName: "Sam", lastName: "Lee" };
    expect((await listOrgTeams(deps(), sam, org))!).toMatchObject({ canManage: false, teams: [{ name: "4B Bolts Lee" }] });
    expect(await createOrgTeam(deps(), sam, org, { gender: "Boys", grades: ["4"], level: "REC" })).toMatchObject({ ok: false });
    expect(await removeOrgTeamCoach(deps(), sam, org, id, "5550008")).toMatchObject({ ok: false });
    expect(await listOrgTeams(deps(), { ...jo, coachId: "5550007" }, org)).toBeNull();

    // Removing the last team a coach is on takes their Coach role away.
    expect(await deleteOrgTeam(deps(), jo, org, id)).toEqual({ ok: true });
    expect(await hasRole("5550009", "Coach")).toBe(false);
    expect(await hasRole("5550008", "Coach")).toBe(false);
  });

  it("a coach with no cell: the team waits for it, named for them; their cell makes them the Head Coach", async () => {
    const text = "Gender,Grade,Level,Coach First,Coach Last\nGirls,3,COMP,Alex,Campbell\nGirls,3,REC,Alex,Campbell";
    expect(await importTeams(deps(), jo, org, text)).toMatchObject({ added: ["3G East Ridge Campbell 1", "3G East Ridge Campbell 2"] });
    const list = (await listOrgTeams(deps(), jo, org))!.teams;
    expect(list.map((t) => [t.name, t.waitingCoach])).toEqual([
      ["3G East Ridge Campbell 1", { first: "Alex", last: "Campbell" }],
      ["3G East Ridge Campbell 2", { first: "Alex", last: "Campbell" }],
    ]);
    const id = list[0].id;
    expect(await setOrgWaitingCoach(deps(), jo, org, id, null)).toMatchObject({ ok: true, name: "3G East Ridge TBD" });
    expect((await getOrgTeam(deps(), jo, org, list[1].id))!.team.name).toBe("3G East Ridge Campbell"); // left alone: no number
    expect(
      await addOrgTeamCoach(deps(), jo, org, list[1].id, {
        first: "Alex",
        last: "Campbell",
        cell: "4235550123",
        role: "HeadCoach",
      }),
    ).toMatchObject({ ok: true });
    const t = (await getOrgTeam(deps(), jo, org, list[1].id))!.team;
    expect([t.name, t.waitingCoach, t.coaches.map((c) => [c.role, c.email])]).toEqual([
      "3G East Ridge Campbell",
      null,
      [["HeadCoach", null]],
    ]);
    expect(await setOrgHeadCoachEmail(deps(), jo, org, list[1].id, "alex@example.com")).toEqual({ ok: true });
    expect(await setOrgHeadCoachEmail(deps(), { ...jo, coachId: "5550007" }, org, list[1].id, "a@b.co")).toMatchObject({
      ok: false,
    });
  });

  it("comes with every organization (CourtClub), and isn't for Thunder or Scenic City", async () => {
    await db.pool.query("delete from org_features where org = $1 and feature = 'court-club'", [org]);
    expect(await listOrgTeams(deps(), jo, org)).not.toBeNull(); // CourtClub can't be turned off
    expect(await listOrgTeams(deps(), jo, "thunder")).toBeNull();
  });

  it("adds many teams at once: a preview first (new, already there, problems), then only the new ones, with coaches", async () => {
    await createOrgTeam(deps(), jo, org, {
      gender: "Boys",
      grades: ["4"],
      level: "REC",
      headCoach: { first: "Sam", last: "Lee", cell: "4235550009" },
    });
    const text = `Gender,Grade,Level,Coach First,Coach Last,Coach Cell,Alternate Name
Boys,4,REC,Sam,Lee,4235550009,
Girls,5th,COMP,Ann,Lee,423-555-0021,Rockets
Boys,3/4,REC,,,,Comets
Girls,5,REC,Ann,Lee,4235550021,
Coed,3,REC,,,,`;
    const pre = await previewTeamImport(deps(), jo, org, text);
    expect(pre).toMatchObject({ ok: true });
    const rows = (pre as { rows: { name: string; status: string; gradeLabel: string | null }[] }).rows;
    expect(rows.map((r) => `${r.name || "-"}:${r.status}:${r.gradeLabel}`)).toEqual([
      "4B East Ridge Lee:exists:4th",
      "5G Rockets Lee:new:5th", // its Alternate name in place of the organization's
      "4B Comets TBD:new:3rd/4th",
      "5G East Ridge Lee:new:5th",
      "-:error:3rd",
    ]);
    expect(await previewTeamImport(deps(), { ...jo, coachId: "5550007" }, org, text)).toMatchObject({ ok: false });
    expect(await importTeams(deps(), jo, org, text)).toEqual({
      ok: true,
      added: ["5G Rockets Lee", "4B Comets TBD", "5G East Ridge Lee"],
      skipped: ["4B East Ridge Lee: already a team", "Row 6: Gender: Boys or Girls"],
    });
    const list = (await listOrgTeams(deps(), jo, org))!.teams;
    expect(list.map((t) => `${t.name}${t.altName ? ` · ${t.altName}` : ""}`)).toEqual([
      "4B Comets TBD · Comets",
      "4B East Ridge Lee",
      "5G East Ridge Lee",
      "5G Rockets Lee · Rockets",
    ]);
    expect(list.find((t) => t.name === "5G Rockets Lee")!.coaches).toMatchObject([{ name: "Ann Lee", role: "HeadCoach" }]);
    // Again: nothing new.
    expect(await importTeams(deps(), jo, org, text)).toMatchObject({ ok: true, added: [] });

    // Undo: the import's teams go (and their coaches lose the Coach role); a team registered in a program is kept.
    const [batch] = (await listTeamImports(deps(), jo, org))!;
    expect(batch).toMatchObject({ importedBy: "Jordan Harris", teams: 3, left: 3, undoneBy: null });
    expect(batch.names).toHaveLength(3); // tap the line to see its teams
    const rockets = list.find((t) => t.name === "5G Rockets Lee")!.id;
    const st = await db.pool.query<{ id: string }>(
      `insert into scenic_teams (name, gender, grade_low, grade, level, coach_id, created_by, updated_by, org_team_id, owner_coach_id)
       values ('Rockets', 'Girls', 5, 5, 'COMP', null, 'x', 'x', $1, '5550001') returning id::text`,
      [rockets],
    );
    const p = await db.pool.query<{ id: string }>(
      `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
       values ('League', 'L', '2027-01-01', '2027-02-01', '2026-11-01', '2026-12-01', 'x', 'x') returning id::text`,
    );
    const d = await db.pool.query<{ id: string }>(
      "insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Girls', 5, 5) returning id::text",
      [p.rows[0].id],
    );
    const g = await db.pool.query<{ id: string }>(
      "insert into scenic_grade_groups (division_id, grade, level) values ($1, 5, 'COMP') returning id::text",
      [d.rows[0].id],
    );
    const pool = await db.pool.query<{ id: string }>(
      "insert into scenic_pools (group_id, name) values ($1, 'Pool A') returning id::text",
      [g.rows[0].id],
    );
    await db.pool.query(
      "insert into scenic_registrations (program_id, team_id, pool_id, registered_by) values ($1, $2, $3, 'x')",
      [p.rows[0].id, st.rows[0].id, pool.rows[0].id],
    );
    expect(await undoTeamImport(deps(), { ...jo, coachId: "5550007" }, org, batch.id)).toMatchObject({ ok: false });
    expect(await undoTeamImport(deps(), jo, org, batch.id)).toEqual({
      ok: true,
      removed: ["4B Comets TBD", "5G East Ridge Lee"],
      kept: ["5G Rockets Lee"],
    });
    expect((await listOrgTeams(deps(), jo, org))!.teams.map((t) => t.name)).toEqual(["4B East Ridge Lee", "5G Rockets Lee"]);
    // Withdraw it, then undo again: it goes, and Ann loses the Coach role.
    await db.pool.query("delete from scenic_registrations");
    expect(await undoTeamImport(deps(), jo, org, batch.id)).toEqual({ ok: true, removed: ["5G Rockets Lee"], kept: [] });
    expect(await hasRole("5550021", "Coach")).toBe(false);
    expect(await listTeamImports(deps(), jo, org)).toEqual([]); // undone: no longer listed
    expect(await undoTeamImport(deps(), jo, org, batch.id)).toMatchObject({ ok: false, message: /already undid/ });
  });

  it("rosters: add players (one or many, previewed), unique names and jersey numbers; coaches see, can't change", async () => {
    const t = (await createOrgTeam(deps(), jo, org, { gender: "Girls", grades: ["4"], level: "REC" })) as { id: string };
    expect((await listOrgTeams(deps(), jo, org))!.teams[0].players).toBe(0); // ROSTER MUST BE ENTERED
    expect(await addOrgPlayer(deps(), jo, org, t.id, { first: "Ava", last: "Smith", grade: "4th", jersey: "12" })).toMatchObject({
      ok: true,
    });
    expect(await addOrgPlayer(deps(), jo, org, t.id, { first: "ava", last: "smith", grade: "4" })).toMatchObject({ ok: false });
    expect(await addOrgPlayer(deps(), jo, org, t.id, { first: "Mia", last: "Lee", grade: "4", jersey: "12" })).toEqual({
      ok: false,
      message: "#12 is taken",
    });
    expect(await addOrgPlayer(deps(), jo, org, t.id, { first: "=x", last: "Lee", grade: "4" })).toMatchObject({ ok: false });
    const text = "First,Last,Grade,Jersey\nAva,Smith,4,\nMia,Lee,4,5\nZoe,Kim,13,";
    const pre = (await previewPlayerImport(deps(), jo, org, t.id, text)) as { rows: { first: string; status: string }[] };
    expect(pre.rows.map((r) => `${r.first}:${r.status}`)).toEqual(["Ava:exists", "Mia:new", "Zoe:error"]);
    expect(await importOrgPlayers(deps(), jo, org, t.id, text)).toEqual({
      ok: true,
      added: ["Mia Lee"],
      skipped: ["Ava Smith: already on the team", "Zoe Kim: Grade: K to 12"],
    });
    const r = (await listOrgRoster(deps(), jo, org, t.id))!;
    expect(r.players.map((p) => `${p.first} ${p.last} ${p.jersey ?? "-"}`)).toEqual(["Mia Lee 5", "Ava Smith 12"]);
    expect(await removeOrgPlayer(deps(), { ...jo, coachId: "5550007" }, org, t.id, r.players[0].id)).toMatchObject({ ok: false });
    expect(await removeOrgPlayer(deps(), jo, org, t.id, r.players[0].id)).toEqual({ ok: true });
    expect((await listOrgTeams(deps(), jo, org))!.teams[0].players).toBe(1);
  });

  it("without CourtPlayers the team's Head and Assistant Coaches enter its roster; with CourtPlayers only its Directors", async () => {
    const t = (await createOrgTeam(deps(), jo, org, { gender: "Girls", grades: ["4"], level: "REC" })) as { id: string };
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550008', 'Cam', 'Coach', '4235550008'), ('5550009', 'Nat', 'Nobody', '4235550009')",
    );
    await db.pool.query("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550008', 'AsstCoach', 't')", [t.id]);
    const cam = { ...jo, coachId: "5550008", firstName: "Cam", lastName: "Coach" };
    const nat = { ...jo, coachId: "5550009" };
    expect((await listOrgRoster(deps(), cam, org, t.id))!.canManage).toBe(true);
    expect(await addOrgPlayer(deps(), cam, org, t.id, { first: "Ava", last: "Smith", grade: "4", jersey: "3" })).toMatchObject({ ok: true });
    expect(await importOrgPlayers(deps(), cam, org, t.id, "Mia,Lee,4,5")).toMatchObject({ ok: true, added: ["Mia Lee"] });
    expect(await addOrgPlayer(deps(), nat, org, t.id, { first: "Zoe", last: "Kim", grade: "4" })).toMatchObject({ ok: false }); // not its coach
    const r = (await listOrgRoster(deps(), cam, org, t.id))!;
    expect(r.players.map((p) => p.first)).toEqual(["Mia", "Ava"]);
    // With CourtPlayers the roster comes from registrations, set by its Directors: the coach can't change it.
    await db.pool.query("insert into org_features (org, feature, source, turned_on_by) values ($1, 'court-players', 'setup', 't')", [org]);
    expect((await listOrgRoster(deps(), cam, org, t.id))!.canManage).toBe(false);
    expect(await removeOrgPlayer(deps(), cam, org, t.id, r.players[0].id)).toMatchObject({ ok: false });
    expect(await removeOrgPlayer(deps(), jo, org, t.id, r.players[0].id)).toEqual({ ok: true });
  });

  it("Team Managers and Team Parents join the staff without becoming coaches", async () => {
    const made = await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: ["5"], level: "COMP", headCoach: "none" } as Parameters<
      typeof createOrgTeam
    >[3]);
    const id = (made as { id: string }).id;
    const add = (role: string, cell: string, first: string) =>
      addOrgTeamCoach(deps(), jo, org, id, { first, last: "Staff", cell, role });
    expect(await add("Manager", "4235550201", "Max")).toMatchObject({ ok: true });
    expect(await add("TeamParent", "4235550202", "Pam")).toMatchObject({ ok: true });
    expect(await add("Boss", "4235550203", "Bo")).toMatchObject({ ok: false });
    expect(await add("TeamParent", "4235550201", "Max")).toMatchObject({ ok: false, message: expect.stringContaining("already") });
    const t = (await getOrgTeam(deps(), jo, org, id))!.team;
    expect(t.coaches.map((c) => c.role).sort()).toEqual(["Manager", "TeamParent"]);
    expect(t.name).toBe("5B East Ridge TBD"); // no Head Coach yet
    expect([await hasRole("5550201", "Coach"), await hasRole("5550202", "Coach")]).toEqual([false, false]);
    expect(await removeOrgTeamCoach(deps(), jo, org, id, "5550201")).toEqual({ ok: true });
    expect((await getOrgTeam(deps(), jo, org, id))!.team.coaches.map((c) => c.role)).toEqual(["TeamParent"]);
  });
});
