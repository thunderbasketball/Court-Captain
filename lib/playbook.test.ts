import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testing/db";
import { addPlay, canKeepOrgPlaybook, canUsePlaybook, changePlay, copyPlay, listFormations, listPlays, orgLibrary, removeFormation, removePlay, saveFormation } from "./playbook";
import { startFrame } from "./play-diagram";
import { BUILT_IN, formationsFor } from "./play-formations";

describe("CourtPlaybook: each team's plays", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => {
    await db?.drop();
  });
  const now = new Date("2026-11-15T17:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const person = (coachId: string, extra: object = {}) =>
    ({ coachId, firstName: "P", lastName: coachId, isDirector: false, thunderAreas: [], ...extra }) as never;
  const coach = person("5550001");
  const parent = person("5550002");
  const director = person("5550003", { isDirector: true, thunderAreas: ["teams"] });
  const other = person("5550004"); // another organization's coach
  let T = { org: "thunder", teamId: "" };
  let E = { org: "east-ridge", teamId: "" };

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('5550001', 'P', '5550001', '4235550001'), ('5550002', 'P', '5550002', '4235550002'), ('5550004', 'P', '5550004', '4235550004')`,
    );
    const t = (
      await db.pool.query<{ id: string }>(
        "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x'), ($1, '5550002', 'TeamParent', 'x')", [t]);
    await db.pool.query("delete from org_role_types where org = 'east-ridge'");
    await db.pool.query("delete from organizations where slug = 'east-ridge'");
    await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('east-ridge', 'East Ridge', 'ER', 'Organization')");
    const e = (
      await db.pool.query<{ id: string }>(
        "insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('east-ridge', '5B Ace', 'Boys', 5, 5, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550004', 'HeadCoach', 'x')", [e]);
    await db.pool.query("insert into org_features (org, feature, source) values ('thunder', 'court-playbook', 'setup'), ('east-ridge', 'court-playbook', 'setup') on conflict do nothing");
    T = { org: "thunder", teamId: t };
    E = { org: "east-ridge", teamId: e };
  });

  it("the team's coaches and Directors of Teams use it; a Team Parent or another team's coach can't; off without CourtPlaybook", async () => {
    expect(await canUsePlaybook(db.pool, coach, T)).toBe(true);
    expect(await canUsePlaybook(db.pool, director, T)).toBe(true);
    expect(await canUsePlaybook(db.pool, parent, T)).toBe(false);
    expect(await canUsePlaybook(db.pool, other, T)).toBe(false);
    expect(await canUsePlaybook(db.pool, other, E)).toBe(true);
    expect(await canUsePlaybook(db.pool, coach, E)).toBe(false);
    expect(await listPlays(deps(), parent, T)).toBeNull();
    expect(await addPlay(deps(), parent, T, { name: "Horns", kind: "Offense" })).toMatchObject({ ok: false });
    await db.pool.query("delete from org_features where feature = 'court-playbook'");
    expect(await canUsePlaybook(db.pool, coach, T)).toBe(false);
  });

  it("plays: add, change, remove; sorted by type then name; names unique on the team; who did it recorded", async () => {
    expect(await addPlay(deps(), coach, T, { name: "Horns", kind: "Offense", notes: "Bigs at the elbows" })).toMatchObject({ ok: true });
    expect(await addPlay(deps(), coach, T, { name: "Box", kind: "Inbounds" })).toMatchObject({ ok: true });
    const z = (await addPlay(deps(), coach, T, { name: "2-3 Zone", kind: "Defense" })) as { id: string };
    expect(await addPlay(deps(), coach, T, { name: "Cutthroat", kind: "Drill" })).toMatchObject({ ok: true });
    expect(await addPlay(deps(), coach, T, { name: "Flex", kind: "Offense" })).toMatchObject({ ok: true });
    expect(await addPlay(deps(), coach, T, { name: " horns ", kind: "Drill" })).toMatchObject({ ok: false, message: expect.stringContaining("already") });
    expect(await addPlay(deps(), coach, T, { name: "", kind: "Offense" })).toMatchObject({ ok: false });
    expect(await addPlay(deps(), coach, T, { name: "=HYPERLINK()", kind: "Offense" })).toMatchObject({ ok: false });
    expect(await addPlay(deps(), coach, T, { name: "Press", kind: "Zone" })).toMatchObject({ ok: false });
    // The same name on another team is fine.
    expect(await addPlay(deps(), other, E, { name: "Horns", kind: "Offense" })).toMatchObject({ ok: true });

    const list = (await listPlays(deps(), coach, T))!;
    expect(list.map((p) => `${p.kind} ${p.name}`)).toEqual(["Offense Flex", "Offense Horns", "Defense 2-3 Zone", "Inbounds Box", "Drill Cutthroat"]);
    expect(list[1]).toMatchObject({ notes: "Bigs at the elbows", addedBy: "P 5550001", changedBy: null });

    expect(await changePlay(deps(), director, T, z.id, { name: "1-3-1 Zone", kind: "Defense", notes: "Trap the corners" })).toEqual({ ok: true });
    expect((await listPlays(deps(), coach, T))!.find((p) => p.id === z.id)).toMatchObject({ name: "1-3-1 Zone", changedBy: "P 5550003" });
    expect(await changePlay(deps(), coach, T, z.id, { name: "Flex", kind: "Defense" })).toMatchObject({ ok: false });
    // Another team's play can't be reached through this team.
    expect(await changePlay(deps(), other, E, z.id, { name: "X", kind: "Defense" })).toMatchObject({ ok: false });
    expect(await removePlay(deps(), other, E, z.id)).toMatchObject({ ok: false });
    // Its drawing: saved with it, kept when a change doesn't send one, and checked.
    const drawn = [startFrame(), { ...startFrame(), lines: [{ kind: "cut" as const, from: "2", x: 250, y: 80 }] }];
    expect(await changePlay(deps(), coach, T, z.id, { name: "1-3-1 Zone", kind: "Defense", frames: drawn })).toEqual({ ok: true });
    expect((await listPlays(deps(), coach, T))!.find((p) => p.id === z.id)!.frames).toEqual(drawn);
    expect(await changePlay(deps(), coach, T, z.id, { name: "1-3-1 Zone", kind: "Defense" })).toEqual({ ok: true });
    expect((await listPlays(deps(), coach, T))!.find((p) => p.id === z.id)!.frames).toHaveLength(2);
    expect(await changePlay(deps(), coach, T, z.id, { name: "1-3-1 Zone", kind: "Defense", frames: [{ ...startFrame(), ball: "X1" }] })).toMatchObject({ ok: false });
    expect(await removePlay(deps(), coach, T, z.id)).toEqual({ ok: true });
    expect((await listPlays(deps(), coach, T))!.length).toBe(4);
  });

  it("the organization's own playbook (Owners and Admins); teams share plays; coaches copy from the library", async () => {
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550005', 'Ad', 'Min', '4235550005')");
    await db.pool.query("select set_role('5550005', 'thunder', 'Admin', true, 'test')");
    const admin = person("5550005");
    const O = { org: "thunder", teamId: "" };
    expect(await canKeepOrgPlaybook(db.pool, admin, "thunder")).toBe(true);
    expect(await canKeepOrgPlaybook(db.pool, coach, "thunder")).toBe(false);
    expect(await addPlay(deps(), coach, O, { name: "Thunder Motion", kind: "Offense" })).toMatchObject({ ok: false });
    const own = (await addPlay(deps(), admin, O, { name: "Thunder Motion", kind: "Offense", frames: [startFrame()] })) as { id: string };
    expect(own).toMatchObject({ ok: true });
    expect(await addPlay(deps(), admin, O, { name: "thunder motion", kind: "Drill" })).toMatchObject({ ok: false, message: expect.stringContaining("organization's playbook") });
    expect((await listPlays(deps(), admin, O))!.map((p) => p.name)).toEqual(["Thunder Motion"]);
    expect(await listPlays(deps(), coach, O)).toBeNull();

    // A team shares its play; the library has the organization's plays first, then the shared ones with their team.
    const horns = (await addPlay(deps(), coach, T, { name: "Horns", kind: "Offense", notes: "Elbows" })) as { id: string };
    const org = { name: "Horns", kind: "Offense", notes: "Elbows", visibility: "org" };
    expect(await changePlay(deps(), parent, T, horns.id, org)).toMatchObject({ ok: false });
    expect(await changePlay(deps(), coach, T, horns.id, org)).toEqual({ ok: true });
    expect((await orgLibrary(deps(), admin, "thunder"))!.map((p) => [p.name, p.team, p.sharedBy])).toEqual([
      ["Thunder Motion", null, null],
      ["Horns", "4G A", "P 5550001"],
    ]);
    // Its own team doesn't see its own shared play in the library; another organization's coach sees nothing.
    expect((await orgLibrary(deps(), coach, "thunder", T.teamId))!.map((p) => p.name)).toEqual(["Thunder Motion"]);
    expect(await orgLibrary(deps(), parent, "thunder", T.teamId)).toBeNull();
    expect(await orgLibrary(deps(), other, "thunder")).toBeNull();

    // Copies: the organization's play to the team; a shared team play to the organization's playbook.
    expect(await copyPlay(deps(), coach, T, own.id)).toMatchObject({ ok: true });
    expect((await listPlays(deps(), coach, T))!.find((p) => p.name === "Thunder Motion")!.frames).toHaveLength(1);
    expect(await copyPlay(deps(), coach, T, own.id)).toMatchObject({ ok: false, message: expect.stringContaining("already") });
    expect(await copyPlay(deps(), admin, O, horns.id)).toMatchObject({ ok: true });
    expect(await copyPlay(deps(), other, E, own.id)).toMatchObject({ ok: false }); // another organization's
    // Not shared any more: can't be copied.
    expect(await changePlay(deps(), coach, T, horns.id, { ...org, visibility: "team" })).toEqual({ ok: true });
    expect(await copyPlay(deps(), admin, { org: "thunder", teamId: "" }, horns.id)).toMatchObject({ ok: false });
    expect((await orgLibrary(deps(), admin, "thunder"))!.map((p) => p.name)).toEqual(["Horns", "Thunder Motion"]);
  });

  it("who sees each play: Private (only its maker), Team, Org (the organization's library), Public (every organization)", async () => {
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550006', 'As', 'St', '4235550006')");
    await db.pool.query("insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550006', 'AsstCoach', 'x')", [T.teamId]);
    const asst = person("5550006");
    const O = { org: "thunder", teamId: "" };
    // A new play is Team; the setting is checked; the organization's own plays have no Team.
    const p = (await addPlay(deps(), coach, T, { name: "Secret", kind: "Offense", visibility: "private" })) as { id: string };
    expect(p).toMatchObject({ ok: true });
    const team = (await addPlay(deps(), coach, T, { name: "Box", kind: "Inbounds" })) as { id: string };
    expect(await addPlay(deps(), coach, T, { name: "X", kind: "Offense", visibility: "everyone" })).toMatchObject({ ok: false });
    expect(await addPlay(deps(), director, O, { name: "X", kind: "Offense", visibility: "team" })).toMatchObject({ ok: false });
    const mine = (await listPlays(deps(), coach, T))!;
    expect(mine.map((x) => [x.name, x.visibility, x.mine])).toEqual([
      ["Secret", "private", true],
      ["Box", "team", true],
    ]);
    // Private: the other coach and the Director of Teams don't see, change or delete it.
    expect((await listPlays(deps(), asst, T))!.map((x) => [x.name, x.mine])).toEqual([["Box", false]]);
    expect((await listPlays(deps(), director, T))!.map((x) => x.name)).toEqual(["Box"]);
    expect(await changePlay(deps(), asst, T, p.id, { name: "Secret", kind: "Offense", visibility: "public" })).toMatchObject({ ok: false });
    expect(await removePlay(deps(), asst, T, p.id)).toMatchObject({ ok: false });
    // Only its maker may make a play Private.
    expect(await changePlay(deps(), asst, T, team.id, { name: "Box", kind: "Inbounds", visibility: "private" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("Only the coach who made"),
    });
    // Private and Team plays aren't in the library and can't be copied.
    expect(await orgLibrary(deps(), other, "east-ridge", E.teamId)).toEqual([]);
    expect(await copyPlay(deps(), other, E, team.id)).toMatchObject({ ok: false });
    // Public: every organization's coaches see it (with the organization's name) and copy it; who set it is recorded.
    expect(await changePlay(deps(), asst, T, team.id, { name: "Box", kind: "Inbounds", visibility: "public" })).toEqual({ ok: true });
    expect((await listPlays(deps(), coach, T))!.find((x) => x.id === team.id)).toMatchObject({ visibility: "public", sharedBy: "P 5550006" });
    expect((await orgLibrary(deps(), other, "east-ridge", E.teamId))!.map((x) => [x.name, x.orgName, x.team])).toEqual([["Box", "Thunder", "4G A"]]);
    const copy = (await copyPlay(deps(), other, E, team.id)) as { id: string };
    expect(copy).toMatchObject({ ok: true });
    expect((await listPlays(deps(), other, E))!.map((x) => [x.name, x.visibility, x.mine])).toEqual([["Box", "team", true]]);
    // Its own organization sees it too; its own team doesn't get it back in the library.
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550005', 'Ad', 'Min', '4235550005')");
    await db.pool.query("select set_role('5550005', 'thunder', 'Admin', true, 'test')");
    expect((await orgLibrary(deps(), person("5550005"), "thunder"))!.map((x) => [x.name, x.orgName])).toEqual([["Box", null]]);
    expect(await orgLibrary(deps(), coach, "thunder", T.teamId)).toEqual([]);
    // Back to Team: gone from every library, no longer copyable.
    expect(await changePlay(deps(), coach, T, team.id, { name: "Box", kind: "Inbounds", visibility: "team" })).toEqual({ ok: true });
    expect(await orgLibrary(deps(), other, "east-ridge", E.teamId)).toEqual([]);
    expect(await copyPlay(deps(), other, E, team.id)).toMatchObject({ ok: false });
  });

  it("Base Formations: built in, a playbook's own (drawn spots), plays grouped by them; renames carry plays along", async () => {
    // The built-ins: Offense and Defense, each player once and on the court.
    for (const k of ["Offense", "Defense"] as const) expect(formationsFor(k, []).map((f) => f.name)).toEqual(BUILT_IN.filter((b) => b.kind === k).map((b) => b.name));
    expect(formationsFor("Defense", []).find((f) => f.name === "Man-to-Man")!.spots.spots).toHaveLength(10);
    // A play keeps its formation (Offense and Defense only; checked).
    const h = (await addPlay(deps(), coach, T, { name: "Horns Twist", kind: "Offense", formation: "Horns" })) as { id: string };
    expect(h).toMatchObject({ ok: true });
    await addPlay(deps(), coach, T, { name: "Box", kind: "Inbounds", formation: "Horns" });
    expect(await addPlay(deps(), coach, T, { name: "X", kind: "Offense", formation: "=SUM(1)" })).toMatchObject({ ok: false });
    expect((await listPlays(deps(), coach, T))!.map((p) => [p.name, p.formation])).toEqual([
      ["Horns Twist", "Horns"],
      ["Box", null],
    ]);
    // A playbook's own formation: its coaches add it; another organization's coach can't; names unique per type.
    const spots = { spots: [{ id: "1", x: 250, y: 320 }, { id: "5", x: 250, y: 60 }], ball: "1", lines: [{ kind: "cut", from: "5", x: 1, y: 1 }] };
    expect(await saveFormation(deps(), other, T, null, { kind: "Offense", name: "Stack", spots })).toMatchObject({ ok: false });
    expect(await saveFormation(deps(), coach, T, null, { kind: "Offense", name: "Stack", spots: { spots: [], ball: null, lines: [] } })).toMatchObject({ ok: false });
    expect(await saveFormation(deps(), coach, T, null, { kind: "Inbounds", name: "Stack", spots })).toMatchObject({ ok: false });
    const st = (await saveFormation(deps(), coach, T, null, { kind: "Offense", name: "Stack", spots })) as { id: string };
    expect(st).toMatchObject({ ok: true });
    expect(await saveFormation(deps(), director, T, null, { kind: "Offense", name: "stack", spots })).toMatchObject({ ok: false, message: expect.stringContaining("already") });
    expect(await saveFormation(deps(), director, T, null, { kind: "Defense", name: "Stack", spots: { spots: [{ id: "X1", x: 1, y: 1 }], ball: null, lines: [] } })).toMatchObject({ ok: true });
    const own = (await listFormations(deps(), coach, T))!;
    expect(own.map((f) => [f.kind, f.name, f.addedBy])).toEqual([
      ["Offense", "Stack", "P 5550001"],
      ["Defense", "Stack", "P 5550003"],
    ]);
    expect(own[0].spots.lines).toEqual([]); // spots only
    expect(await listFormations(deps(), other, T)).toBeNull();
    // A built-in's name: the playbook's own version replaces it.
    const mine = (await saveFormation(deps(), coach, T, null, { kind: "Offense", name: "Horns", spots })) as { id: string };
    expect(formationsFor("Offense", (await listFormations(deps(), coach, T))!).find((f) => f.name === "Horns")).toMatchObject({ id: mine.id });
    // Renaming carries its plays along; deleting leaves them under the name.
    await addPlay(deps(), coach, T, { name: "Stack Pop", kind: "Offense", formation: "stack" });
    expect(await saveFormation(deps(), coach, T, st.id, { kind: "Offense", name: "Stack High", spots })).toMatchObject({ ok: true });
    expect((await listPlays(deps(), coach, T))!.find((p) => p.name === "Stack Pop")!.formation).toBe("Stack High");
    expect(await removeFormation(deps(), other, E, st.id)).toMatchObject({ ok: false });
    expect(await removeFormation(deps(), coach, T, st.id)).toEqual({ ok: true });
    expect(formationsFor("Offense", (await listFormations(deps(), coach, T))!, ["Stack High"]).map((f) => f.name)).toContain("Stack High");
    // A copy keeps its formation.
    await changePlay(deps(), coach, T, h.id, { name: "Horns Twist", kind: "Offense", formation: "Horns", visibility: "public" });
    const c = (await copyPlay(deps(), other, E, h.id)) as { id: string };
    expect((await listPlays(deps(), other, E))!.find((p) => p.id === c.id)!.formation).toBe("Horns");
  });

  it("video links: web links only, up to 5, each once; kept when not sent; copied with the play", async () => {
    const p = (await addPlay(deps(), coach, T, {
      name: "Horns",
      kind: "Offense",
      videos: ["youtu.be/dQw4w9WgXcQ", "", "https://youtu.be/dQw4w9WgXcQ", "https://vimeo.com/123456789"],
    })) as { id: string };
    expect(p).toMatchObject({ ok: true });
    expect((await listPlays(deps(), coach, T))![0].videos).toEqual(["https://youtu.be/dQw4w9WgXcQ", "https://vimeo.com/123456789"]);
    expect(await addPlay(deps(), coach, T, { name: "X", kind: "Offense", videos: ["javascript:alert(1)"] })).toMatchObject({ ok: false });
    expect(await addPlay(deps(), coach, T, { name: "X", kind: "Offense", videos: [1] })).toMatchObject({ ok: false });
    const six = ["a", "b", "c", "d", "e", "f"].map((x) => `https://example.com/${x}`);
    expect(await addPlay(deps(), coach, T, { name: "X", kind: "Offense", videos: six })).toMatchObject({ ok: false, message: expect.stringContaining("Up to 5") });
    // Not sent: kept. Sent empty: cleared.
    expect(await changePlay(deps(), coach, T, p.id, { name: "Horns", kind: "Offense" })).toEqual({ ok: true });
    expect((await listPlays(deps(), coach, T))![0].videos).toHaveLength(2);
    expect(await changePlay(deps(), coach, T, p.id, { name: "Horns", kind: "Offense", visibility: "public", videos: ["https://vimeo.com/123456789"] })).toEqual({ ok: true });
    const c = (await copyPlay(deps(), other, E, p.id)) as { id: string };
    expect((await listPlays(deps(), other, E))!.find((x) => x.id === c.id)!.videos).toEqual(["https://vimeo.com/123456789"]);
    expect(await changePlay(deps(), coach, T, p.id, { name: "Horns", kind: "Offense", videos: [] })).toEqual({ ok: true });
    expect((await listPlays(deps(), coach, T))![0].videos).toEqual([]);
  });
});
