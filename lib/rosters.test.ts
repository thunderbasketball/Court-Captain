import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addPlayers, allRosterBoards, listRoster, movePlayer, removePlayer, rosterBoard, rosterCandidates } from "./rosters";
import { createTestDb } from "./testing/db";

const person = (coachId: string, firstName: string, isDirector = false): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector,
  isCoach: true,
  requestPending: false,
  hasThunderRole: true,
});
const director = person("9913694", "Earl", true);
const head = person("5550001", "Hank");
const stranger = person("5550002", "Amy");

describe("rosters", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-10-28T12:00:00Z") });
  let team = "";
  let other = "";
  const reg = (id: string, first: string, last: string, gender: string, grade: string) =>
    db.pool.query(
      `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw, imported_at, imported_by)
       values ($1, $1, $2, $3, $4, $5, $6, 'x', '{}', now(), 'x')`,
      [id, first, last, gender, grade, Number(grade)],
    );

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Hank', 'X', '4235550001'), ('5550002', 'Amy', 'X', '4235550002')`,
    );
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x'), ('4G B', 'Girls', '{4}', 4, 'COMP', 'x') returning id::text`,
    );
    [team, other] = t.rows.map((r) => r.id);
    await db.pool.query(`insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x')`, [
      team,
    ]);
    await reg("r1", "Ava", "Zed", "Girls", "4");
    await reg("r2", "Bea", "Young", "Girls", "4");
    await reg("r3", "Cy", "Ames", "Boys", "4");
    await reg("r4", "Dee", "Bell", "Girls", "5");
  });

  it("players are offered by the age control date: free eligible players first, then those on a team", async () => {
    const born = (id: string, d: string) => db.pool.query("update registrations set birthdate = $2 where registrant_id = $1", [id, d]);
    await reg("r5", "Eve", "Low", "Girls", "3"); // a grade below: eligible
    await reg("r6", "Fay", "Old", "Girls", "4");
    await reg("r7", "Gia", "Kid", "Girls", "5");
    await born("r5", "2017-05-01");
    await born("r6", "2014-01-01"); // turns 13 before Aug 1, 2027: too old for 4th
    await born("r7", "2016-09-01"); // 5th grader who doesn't turn 11 before Aug 1, 2027: age exception
    await addPlayers(deps(), director, other, ["r2"]);
    const c = await rosterCandidates(deps(), director, team);
    expect(c.map((x) => [x.firstName, x.fits, x.note])).toEqual([
      ["Eve", true, null],
      ["Ava", true, "No birthdate"],
      ["Gia", true, "Age exception"],
      ["Bea", true, "No birthdate"], // already on 4G B
      ["Cy", false, "No birthdate"], // a boy
      ["Fay", false, "Too old"],
      ["Dee", false, "No birthdate"],
    ]);
  });

  it("the Director adds players (who rostered them is recorded); fitting players are offered first", async () => {
    expect((await rosterCandidates(deps(), director, team)).map((c) => [c.firstName, c.fits])).toEqual([
      ["Bea", true],
      ["Ava", true],
      ["Cy", false],
      ["Dee", false],
    ]);
    expect(await addPlayers(deps(), director, team, ["r1", "r2", "r2", "nope!"])).toEqual({ ok: true, added: 2 });
    expect(await addPlayers(deps(), director, team, ["r1"])).toEqual({ ok: true, added: 0 });
    const roster = await listRoster(deps(), director, team);
    expect(roster?.map((p) => [p.firstName, p.rosteredBy, p.registered])).toEqual([
      ["Bea", "Earl X", true],
      ["Ava", "Earl X", true],
    ]);
    // Offered for the other team, showing where they already are.
    await addPlayers(deps(), director, other, ["r4"]);
    expect((await rosterCandidates(deps(), director, other)).find((c) => c.firstName === "Ava")?.otherTeams).toEqual(["4G A"]);
    expect((await rosterCandidates(deps(), director, team)).map((c) => c.firstName)).toEqual(["Cy", "Dee"]);
    // A 2nd team: a Director of Teams alone can't; Owners, Admins and Directors of Players can, once they confirm.
    const teamsOnly = { ...director, thunderAreas: ["teams" as const], isAdmin: false };
    expect(await addPlayers(deps(), teamsOnly, other, ["r1", "r3"], true)).toEqual({
      ok: false,
      message:
        "Already on another team: Ava Zed (4G A). Only an Owner, Admin or Director of Players can put a player on a 2nd team.",
    });
    expect(await addPlayers(deps(), director, other, ["r1", "r3"])).toEqual({
      ok: false,
      message: "Already on another team: Ava Zed (4G A). Confirm to put them on a 2nd team.",
    });
    expect(await listRoster(deps(), director, other)).toMatchObject([{ firstName: "Dee" }]); // nothing added
    const players = { ...director, thunderAreas: ["teams" as const, "players" as const], isAdmin: false };
    expect(await addPlayers(deps(), players, other, ["r1", "r3"], true)).toEqual({ ok: true, added: 2 });
    expect((await listRoster(deps(), director, team))!.map((p) => p.firstName)).toEqual(["Bea", "Ava"]); // still on the first
    // Never a 3rd team.
    const third = (
      await db.pool.query<{ id: string }>(
        "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G C', 'Girls', '{4}', 4, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    expect(await addPlayers(deps(), director, third, ["r1"], true)).toEqual({
      ok: false,
      message: "Already on two teams: Ava Zed (4G A, 4G B). A player can be on two teams at most.",
    });
    // The roster board moves them off only the team they're dragged from, so their 2nd team stays.
    expect(await movePlayer(deps(), director, "r1", third, team)).toEqual({ ok: true });
    expect(
      (
        await db.pool.query(
          "select t.name from team_players p join teams t on t.id = p.team_id where registrant_id = 'r1' order by t.name",
        )
      ).rows.map((r) => r.name),
    ).toEqual(["4G B", "4G C"]);
    expect(await movePlayer(deps(), director, "r1", null, third)).toEqual({ ok: true });
    expect(
      (
        await db.pool.query("select t.name from team_players p join teams t on t.id = p.team_id where registrant_id = 'r1'")
      ).rows.map((r) => r.name),
    ).toEqual(["4G B"]);
  });

  it("staff can see their roster but not change it; others can't see it", async () => {
    await db.pool.query(
      `update registrations set parent1_first = 'Pam', parent1_last = 'Ames', parent1_cell = '(423) 555-7777', parent1_email = 'pam@x.com',
              parent2_first = 'Jo', parent2_cell = 'none', parent2_email = 'not an email' where registrant_id = 'r1'`,
    );
    await addPlayers(deps(), director, team, ["r1"]);
    const seen = await listRoster(deps(), head, team);
    expect(seen?.length).toBe(1);
    expect(seen![0].parents).toEqual([
      { name: "Pam Ames", cell: "4235557777", email: "pam@x.com" },
      { name: "Jo", cell: null, email: null },
    ]);
    expect(await listRoster(deps(), stranger, team)).toBeNull();
    expect(await addPlayers(deps(), head, team, ["r2"])).toEqual({
      ok: false,
      message: "Only a Director of Teams can change rosters.",
    });
    expect(await removePlayer(deps(), head, team, "r1")).toMatchObject({ ok: false });
    expect(await rosterCandidates(deps(), head, team)).toEqual([]);
  });

  it("remove, and a player who left registrations stays on the roster, marked", async () => {
    await addPlayers(deps(), director, team, ["r1", "r2"]);
    expect(await removePlayer(deps(), director, team, "r2")).toEqual({ ok: true });
    expect(await removePlayer(deps(), director, team, "r2")).toMatchObject({ ok: false });
    await db.pool.query("delete from registrations where registrant_id = 'r1'");
    expect(await listRoster(deps(), director, team)).toMatchObject([{ firstName: "Ava", registered: false }]);
  });

  it("roster board: drag a player onto a team, to another team (moved, never on two), and back off", async () => {
    const names = (b: Awaited<ReturnType<typeof rosterBoard>>) => ({
      free: b!.unrostered.map((p) => p.firstName),
      teams: b!.teams.map((t) => `${t.name}: ${t.players.map((p) => p.firstName).join(",")}`),
    });
    expect(names(await rosterBoard(deps(), director, "Girls", "4"))).toEqual({
      free: ["Bea", "Ava"],
      teams: ["4G B: ", "4G A: "],
    }); // COMP first
    expect(await movePlayer(deps(), director, "r1", team)).toEqual({ ok: true });
    expect(await movePlayer(deps(), director, "r1", other)).toEqual({ ok: true });
    expect(names(await rosterBoard(deps(), director, "Girls", "4"))).toEqual({ free: ["Bea"], teams: ["4G B: Ava", "4G A: "] });
    expect((await listRoster(deps(), director, other))![0]).toMatchObject({ registrantId: "r1", rosteredBy: "Earl X" });
    // A player who somehow ended up on two teams is left on just the one they're moved to; their uniform elsewhere goes too.
    await db.pool.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       values ($1, 'r1', 'Ava', 'Zed', 'Girls', '4', 4, 'x', now())`,
      [team],
    );
    await db.pool.query(
      "insert into team_uniforms (team_id, registrant_id, number, updated_by, updated_at) values ($1, 'r1', '7', 'x', now())",
      [team],
    );
    expect(await movePlayer(deps(), director, "r1", other)).toEqual({ ok: true });
    expect(names(await rosterBoard(deps(), director, "Girls", "4")).teams).toEqual(["4G B: Ava", "4G A: "]);
    expect((await db.pool.query("select 1 from team_uniforms where registrant_id = 'r1'")).rows).toHaveLength(0);
    expect(await movePlayer(deps(), director, "r1", null)).toEqual({ ok: true });
    expect(names(await rosterBoard(deps(), director, "Girls", "4")).free).toEqual(["Bea", "Ava"]);
    // Only teams named for the grade; their free players are that grade and one below (a 3rd grader shows on the 4th grade board).
    await reg("r5", "Eve", "Cole", "Girls", "3");
    await reg("r6", "Fay", "Dunn", "Girls", "2");
    expect(names(await rosterBoard(deps(), director, "Girls", "4"))).toEqual({
      free: ["Bea", "Ava", "Eve"],
      teams: ["4G B: ", "4G A: "],
    });
    expect((await rosterBoard(deps(), director, "Girls", "3"))!.teams).toHaveLength(0);
    expect(names(await rosterBoard(deps(), director, "Girls", "5")).free).toEqual(["Dee", "Bea", "Ava"]);
  });

  it("whole roster board (Home): Boys then Girls, youngest grade first; not rostered, then that grade's teams", async () => {
    await reg("r5", "Eve", "Cole", "Girls", "3");
    await db.pool.query("update registrations set coach_request = 'Coach Hank' where registrant_id = 'r2'");
    await movePlayer(deps(), director, "r1", other);
    const all = await allRosterBoards(deps(), director);
    expect(
      all!.map((b) => [
        `${b.gender} ${b.grade}`,
        b.unrostered.map((p) => p.firstName),
        b.teams.map((t) => `${t.name}: ${t.players.map((p) => p.firstName).join(",")}`),
      ]),
    ).toEqual([
      ["Boys 4", ["Cy"], []],
      ["Girls 3", ["Eve"], []],
      ["Girls 4", ["Bea"], ["4G B: Ava", "4G A: "]],
      ["Girls 5", ["Dee"], []],
    ]);
    expect(all![2].unrostered[0].coachRequest).toBe("Coach Hank");
    expect(await allRosterBoards(deps(), head)).toBeNull();
  });

  it("roster board: Directors only, and checks its input", async () => {
    expect(await rosterBoard(deps(), head, "Girls", "4")).toBeNull();
    expect(await movePlayer(deps(), head, "r1", team)).toMatchObject({ ok: false });
    expect(await rosterBoard(deps(), director, "Girls", "4; drop table teams")).toBeNull();
    expect(await movePlayer(deps(), director, "nobody", team)).toEqual({ ok: false, message: "That player isn't registered." });
    expect(await movePlayer(deps(), director, "r1", "999999")).toEqual({ ok: false, message: "That team no longer exists." });
  });
});
