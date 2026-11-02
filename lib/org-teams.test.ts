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
    await createOrganization(deps(), jo, { ...input, features: ["team-building"] }, null);
  });

  it("teams are named Grade + Gender + Head Coach (TBD until one), unique; renamed when the Head Coach changes", async () => {
    const add = (input: Record<string, unknown>) =>
      createOrgTeam(deps(), jo, org, { level: "REC", headCoach: "none", ...input } as Parameters<typeof createOrgTeam>[3]);
    expect(await add({ gender: "Girls", grades: ["5"] })).toMatchObject({ ok: true, name: "5G TBD" });
    expect(await add({ gender: "Girls", grades: ["5"] })).toMatchObject({ ok: true, name: "5G TBD 2" });
    const b = await add({
      gender: "Boys",
      grades: ["4", "3"],
      level: "COMP",
      headCoach: { first: "Sam", last: "Lee", cell: "(423) 555-0009" },
      altName: "Bolts",
    });
    expect(b).toMatchObject({ ok: true, name: "4B Lee" });
    const id = (b as { id: string }).id;
    expect(await hasRole("5550009", "Coach")).toBe(true); // login made, Coach role here
    expect(await add({ gender: "Boys", grades: ["4"], headCoach: "user:5550009" })).toEqual({
      ok: false,
      message: 'There\'s already a team named "4B Lee".',
    });
    expect(await add({ gender: "Boys", grades: ["4", "6"] })).toMatchObject({ ok: false }); // not next to each other
    expect(await add({ gender: "Boys", grades: ["4"], altName: "=cmd" })).toMatchObject({ ok: false });

    // An Assistant Coach doesn't change the name; a Head Coach does, and removing them makes it TBD again.
    const coach = { first: "Pat", last: "Lee", cell: "4235550008", role: "AsstCoach" };
    expect(await addOrgTeamCoach(deps(), jo, org, id, coach)).toMatchObject({ ok: true });
    expect(await addOrgTeamCoach(deps(), jo, org, id, { ...coach, role: "HeadCoach" })).toMatchObject({
      ok: false,
      message: "This team already has a Head Coach. Remove them first.",
    });
    const tbd = (await listOrgTeams(deps(), jo, org))!.teams.find((t) => t.name === "5G TBD")!.id;
    expect(
      await addOrgTeamCoach(deps(), jo, org, tbd, { first: "Ann", last: "Kim", cell: "4235550021", role: "HeadCoach" }),
    ).toMatchObject({ ok: true });
    const list = (await listOrgTeams(deps(), jo, org))!;
    expect(list.canManage).toBe(true);
    expect(list.teams.map((t) => `${t.gender} ${t.grade} ${t.level} ${t.name}${t.altName ? ` · ${t.altName}` : ""}`)).toEqual([
      "Boys 3rd/4th COMP 4B Lee · Bolts",
      "Girls 5th REC 5G Kim",
      "Girls 5th REC 5G TBD 2",
    ]);
    expect(list.teams[0].coaches.map((c) => `${c.name} ${c.role} by ${c.addedBy}`)).toEqual([
      "Sam Lee HeadCoach by Jordan Harris",
      "Pat Lee AsstCoach by Jordan Harris",
    ]);
    expect(await removeOrgTeamCoach(deps(), jo, org, tbd, "5550021")).toEqual({ ok: true });
    expect((await getOrgTeam(deps(), jo, org, tbd))!.team.name).toBe("5G TBD");
    expect(await setOrgTeamAltName(deps(), jo, org, tbd, "Rockets")).toEqual({ ok: true });
    expect((await getOrgTeam(deps(), jo, org, tbd))!.team.altName).toBe("Rockets");

    // A coach sees only their teams, and can't change them.
    const sam = { ...jo, coachId: "5550009", firstName: "Sam", lastName: "Lee" };
    expect((await listOrgTeams(deps(), sam, org))!).toMatchObject({ canManage: false, teams: [{ name: "4B Lee" }] });
    expect(await createOrgTeam(deps(), sam, org, { gender: "Boys", grades: ["4"], level: "REC" })).toMatchObject({ ok: false });
    expect(await removeOrgTeamCoach(deps(), sam, org, id, "5550008")).toMatchObject({ ok: false });
    expect(await listOrgTeams(deps(), { ...jo, coachId: "5550007" }, org)).toBeNull();

    // Removing the last team a coach is on takes their Coach role away.
    expect(await deleteOrgTeam(deps(), jo, org, id)).toEqual({ ok: true });
    expect(await hasRole("5550009", "Coach")).toBe(false);
    expect(await hasRole("5550008", "Coach")).toBe(false);
  });

  it("needs Team Management, and isn't for Thunder or Scenic City", async () => {
    await db.pool.query("delete from org_features where org = $1 and feature = 'team-building'", [org]);
    expect(await listOrgTeams(deps(), jo, org)).toBeNull();
    expect(await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: ["4"], level: "REC" })).toMatchObject({ ok: false });
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
      "4B Lee:exists:4th",
      "5G Lee:new:5th",
      "4B TBD:new:3rd/4th",
      "5G Lee:error:5th",
      "-:error:3rd",
    ]);
    expect(await previewTeamImport(deps(), { ...jo, coachId: "5550007" }, org, text)).toMatchObject({ ok: false });
    expect(await importTeams(deps(), jo, org, text)).toEqual({
      ok: true,
      added: ["5G Lee", "4B TBD"],
      skipped: ["4B Lee: already a team", "5G Lee: Listed twice", "Row 6: Gender: Boys or Girls"],
    });
    const list = (await listOrgTeams(deps(), jo, org))!.teams;
    expect(list.map((t) => `${t.name}${t.altName ? ` · ${t.altName}` : ""}`)).toEqual([
      "4B TBD · Comets",
      "4B Lee",
      "5G Lee · Rockets",
    ]);
    expect(list.find((t) => t.name === "5G Lee")!.coaches).toMatchObject([{ name: "Ann Lee", role: "HeadCoach" }]);
    // Again: nothing new.
    expect(await importTeams(deps(), jo, org, text)).toMatchObject({ ok: true, added: [] });

    // Undo: the import's teams go (and their coaches lose the Coach role); a team registered in a program is kept.
    const [batch] = (await listTeamImports(deps(), jo, org))!;
    expect(batch).toMatchObject({ importedBy: "Jordan Harris", teams: 2, left: 2, undoneBy: null });
    const rockets = list.find((t) => t.name === "5G Lee")!.id;
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
    expect(await undoTeamImport(deps(), jo, org, batch.id)).toEqual({ ok: true, removed: ["4B TBD"], kept: ["5G Lee"] });
    expect((await listOrgTeams(deps(), jo, org))!.teams.map((t) => t.name)).toEqual(["4B Lee", "5G Lee"]);
    // Withdraw it, then undo again: it goes, and Ann loses the Coach role.
    await db.pool.query("delete from scenic_registrations");
    expect(await undoTeamImport(deps(), jo, org, batch.id)).toEqual({ ok: true, removed: ["5G Lee"], kept: [] });
    expect(await hasRole("5550021", "Coach")).toBe(false);
    expect((await listTeamImports(deps(), jo, org))![0]).toMatchObject({ left: 0, undoneBy: "Jordan Harris" });
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
});
