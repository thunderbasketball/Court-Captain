import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./testing/db";
import { addPlay, canKeepOrgPlaybook, canUsePlaybook, changePlay, copyPlay, listPlays, orgLibrary, removePlay, sharePlay } from "./playbook";
import { startFrame } from "./play-diagram";

describe("CourtPlaybook: each team's plays", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
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
    expect(await sharePlay(deps(), parent, T, horns.id, true)).toMatchObject({ ok: false });
    expect(await sharePlay(deps(), coach, T, horns.id, true)).toEqual({ ok: true });
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
    expect(await sharePlay(deps(), coach, T, horns.id, false)).toEqual({ ok: true });
    expect(await copyPlay(deps(), admin, { org: "thunder", teamId: "" }, horns.id)).toMatchObject({ ok: false });
    expect((await orgLibrary(deps(), admin, "thunder"))!.map((p) => p.name)).toEqual(["Horns", "Thunder Motion"]);
  });
});
