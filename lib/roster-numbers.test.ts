import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addOrgPlayer, listOrgRoster } from "./org-rosters";
import { createOrganization } from "./org-signup";
import { createOrgTeam } from "./org-teams";
import { leagueRoster } from "./league-roster";
import { setLeagueNumbers, setOrgNumbers } from "./roster-numbers";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false }) as SessionUser;
const jo = person("5550001", "Jo"); // East Ridge Owner
const kim = person("5550002", "Kim"); // the team's Head Coach
const sam = person("5550003", "Sam"); // nobody here
const org = "east-ridge-parks-and-rec";

describe("uniform numbers on typed-in rosters", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  it("whoever may change the roster fills them in: 0–99, unique on the team, all saved or none, who recorded", async () => {
    const deps = { pool: db.pool, now: () => new Date("2026-11-23T15:00:00Z") };
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jo', 'X', '4235550001'), ('5550002', 'Kim', 'X', '4235550002'), ('5550003', 'Sam', 'X', '4235550003')",
    );
    await createOrganization(deps, jo, { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e", features: ["court-club"] }, null);
    const tid = ((await createOrgTeam(deps, jo, org, { gender: "Boys", grades: ["4"], level: "COMP" })) as { id: string }).id;
    await db.pool.query("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550002', 'HeadCoach', 't')", [tid]);
    for (const [first, jersey] of [["Ava", "12"], ["Mia", ""], ["Zoe", ""]])
      await addOrgPlayer(deps, jo, org, tid, { first, last: "P", grade: "4", jersey, birthdate: "5/3/2016" });
    const id = async (first: string) => (await listOrgRoster(deps, jo, org, tid))!.players.find((p) => p.first === first)!.id;
    const [mia, zoe] = [await id("Mia"), await id("Zoe")];
    const numbers = async () => Object.fromEntries((await listOrgRoster(deps, jo, org, tid))!.players.map((p) => [p.first, p.jersey]));
    const set = (who: SessionUser, list: unknown) => setOrgNumbers(deps, who, org, tid, list);

    expect(await set(sam, [{ id: mia, number: "3" }])).toMatchObject({ ok: false });
    expect(await set(kim, [])).toMatchObject({ ok: false });
    for (const bad of ["100", "-1", "=1", "", "1a"]) expect(await set(kim, [{ id: mia, number: bad }])).toEqual({ ok: false, message: "Uniform numbers are 0 to 99." });
    expect(await set(kim, [{ id: mia, number: "3" }, { id: zoe, number: "12" }])).toMatchObject({ ok: false, message: expect.stringContaining("#12 is taken") });
    expect(await set(kim, [{ id: mia, number: "3" }, { id: zoe, number: "3" }])).toMatchObject({ ok: false });
    expect(await set(kim, [{ id: "999999", number: "3" }])).toMatchObject({ ok: false });
    expect(await numbers()).toEqual({ Ava: "12", Mia: null, Zoe: null }); // nothing saved
    expect(await set(kim, [{ id: mia, number: "3" }, { id: zoe, number: "#0" }])).toEqual({ ok: true });
    expect(await numbers()).toEqual({ Ava: "12", Mia: "3", Zoe: "0" });
    expect(await set(kim, [{ id: mia, number: "0" }, { id: zoe, number: "3" }])).toEqual({ ok: true }); // swapped in one save
    expect((await db.pool.query("select jersey_by from org_team_players where id = $1", [mia])).rows[0].jersey_by).toBe("Kim X");

    // A League team kept by Scenic City: its coach.
    await grant(db.pool, "5550002 scenic-city Solo");
    const lt = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('5B Aces', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    const al = (
      await db.pool.query<{ id: string }>("insert into scenic_team_players (team_id, first_name, last_name, added_by) values ($1, 'Al', 'P', 't') returning id::text", [lt])
    ).rows[0].id;
    expect(await setLeagueNumbers(deps, sam, lt, [{ id: al, number: "7" }])).toMatchObject({ ok: false });
    expect(await setLeagueNumbers(deps, kim, lt, [{ id: al, number: "7" }])).toEqual({ ok: true });
    expect((await leagueRoster(db.pool, lt))[0].jersey).toBe("7");
  }, 120_000);
});
