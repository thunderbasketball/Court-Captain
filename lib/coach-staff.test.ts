import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addLeagueDates } from "./league-dates";
import { createOrganization } from "./org-signup";
import { addOrgTeamCoach, createOrgTeam, removeOrgTeamCoach } from "./org-teams";
import { addDivision, saveProgram, saveProgramDates } from "./scenic-programs";
import { leaguePrograms } from "./scenic-team-page";
import { addStaff, createTeam, removeStaff } from "./teams";
import { registerAllThunderTeams } from "./thunder-leagues";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string, more: Partial<SessionUser> = {}): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false, ...more }) as SessionUser;
const earl = person("9913694", "Earl", { isDirector: true, hasThunderRole: true });
const jo = person("5550001", "Jo"); // East Ridge Owner
const hal = person("5550002", "Hal"); // Head Coach
const ann = person("5550003", "Ann"); // Assistant Coach
const sam = person("5550004", "Sam"); // nobody
const org = "east-ridge-parks-and-rec";

describe("a team's own coaches and its staff; Thunder's Directors and its registrations", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = { pool: {} as Awaited<ReturnType<typeof createTestDb>>["pool"], now: () => new Date("2026-11-02T15:00:00Z") };

  beforeEach(async () => {
    deps.pool = db.pool;
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Earl', 'Epps', '4239913694'), ('5550001', 'Jo', 'X', '4235550001'),
         ('5550002', 'Hal', 'Hill', '4235550002'), ('5550003', 'Ann', 'Ash', '4235550003'), ('5550004', 'Sam', 'X', '4235550004')`,
    );
  });

  it("organizations: the Head Coach adds and removes Assistants, Managers and Team Parents; an Assistant, Managers and Team Parents", async () => {
    await createOrganization(deps, jo, { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e", features: ["court-club"] }, null);
    const team = async () => ((await createOrgTeam(deps, jo, org, { gender: "Boys", grades: ["4"], level: "COMP" })) as { id: string }).id;
    const [t, other] = [await team(), await team()];
    await db.pool.query(
      "insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550002', 'HeadCoach', 't'), ($1, '5550003', 'AsstCoach', 't')",
      [t],
    );
    const add = (who: SessionUser, role: string, cell: string, on = t) => addOrgTeamCoach(deps, who, org, on, { first: "New", last: "One", cell, role });
    expect(await add(sam, "Manager", "4235550101")).toMatchObject({ ok: false });
    expect(await add(hal, "HeadCoach", "4235550101")).toMatchObject({ ok: false });
    expect(await add(hal, "Manager", "4235550101", other)).toMatchObject({ ok: false }); // not their team
    expect(await add(hal, "Manager", "4235550101")).toMatchObject({ ok: true, newLogin: true });
    expect(await add(hal, "AsstCoach", "4235550102")).toMatchObject({ ok: true });
    expect(await add(ann, "AsstCoach", "4235550103")).toMatchObject({ ok: false });
    expect(await add(ann, "TeamParent", "4235550104")).toMatchObject({ ok: true });
    const id = async (cell: string) => (await db.pool.query<{ id: string }>("select coach_id as id from users where cell = $1", [cell])).rows[0].id;
    expect(await removeOrgTeamCoach(deps, ann, org, t, "5550002")).toMatchObject({ ok: false }); // never the Head Coach
    expect(await removeOrgTeamCoach(deps, hal, org, t, "5550002")).toMatchObject({ ok: false });
    expect(await removeOrgTeamCoach(deps, ann, org, t, await id("4235550102"))).toMatchObject({ ok: false }); // an Assistant Coach
    expect(await removeOrgTeamCoach(deps, sam, org, t, await id("4235550104"))).toMatchObject({ ok: false });
    expect(await removeOrgTeamCoach(deps, ann, org, t, await id("4235550104"))).toMatchObject({ ok: true });
    expect(await removeOrgTeamCoach(deps, hal, org, t, await id("4235550102"))).toMatchObject({ ok: true });
  }, 120_000);

  it("Thunder: the same; and its Directors add dates or a 2nd Game (CourtPlayers: never its coaches)", async () => {
    await grant(db.pool, "9913694 scenic-city Director", "9913694 scenic-city Admin", "9913694 thunder Director", "9913694 thunder Admin", "5550002 thunder Coach", "5550003 thunder Coach");
    await createTeam(deps, earl, { gender: "Girls", grades: ["4"], level: "COMP", headCoach: "user:5550002" });
    const t = (await db.pool.query<{ id: string }>("select id::text from teams")).rows[0].id;
    expect(await addStaff(deps, earl, t, { role: "AsstCoach", person: "user:5550003" })).toMatchObject({ ok: true });
    const add = (who: SessionUser, role: string, cell: string) => addStaff(deps, who, t, { role, person: { first: "New", last: "One", cell, email: "" } });
    expect(await add(sam, "Manager", "4235550201")).toMatchObject({ ok: false });
    expect(await add(ann, "HeadCoach", "4235550201")).toMatchObject({ ok: false });
    expect(await add(ann, "Manager", "4235550201")).toMatchObject({ ok: true });
    expect(await add(hal, "TeamParent", "4235550202")).toMatchObject({ ok: true });
    expect(await removeStaff(deps, ann, t, { coachId: "5550002", role: "HeadCoach" })).toMatchObject({ ok: false });
    expect(await removeStaff(deps, ann, t, { coachId: "5550003", role: "AsstCoach" })).toMatchObject({ ok: false });
    const mgr = (await db.pool.query<{ id: string }>("select coach_id as id from team_staff where role = 'Manager'")).rows[0].id;
    expect(await removeStaff(deps, ann, t, { coachId: mgr, role: "Manager" })).toMatchObject({ ok: true });

    const pid = (
      (await saveProgram(deps, earl, null, {
        kind: "League", name: "Winter", startsOn: "2026-12-01", endsOn: "2027-02-28", regOpens: "2026-11-01", regCloses: "2026-12-31", fee: "",
        options: [{ kind: "all_season", fee: "0" }, { kind: "single_2nd", fee: "0" }],
      })) as { id: string }
    ).id;
    await saveProgramDates(deps, earl, pid, { add: ["2026-12-05", "2026-12-12"], addBrackets: [], remove: [] });
    await addDivision(deps, earl, pid, { gender: "Girls", from: 3, to: 4, levels: ["COMP"] });
    expect(await registerAllThunderTeams(deps, earl, pid)).toMatchObject({ ok: true });
    const copy = (await db.pool.query<{ id: string }>("select id::text from scenic_teams where thunder_team_id = $1", [t])).rows[0].id;
    const second = { allSeason: false, days: [{ date: "2026-12-05", kind: "single_2nd" }] };
    expect(await addLeagueDates(deps, hal, pid, copy, second)).toEqual({ ok: false, message: "Your Director handles registrations." });
    expect(await addLeagueDates(deps, sam, pid, copy, second)).toMatchObject({ ok: false });
    // A Thunder Director of Teams with nothing in the League itself.
    await grant(db.pool, "5550004 thunder Director");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'thunder', 'teams', 't')");
    expect(await addLeagueDates(deps, sam, pid, copy, second)).toMatchObject({ ok: true });
    expect((await leaguePrograms(db.pool, copy))[0]).toMatchObject({ name: "Winter", entry: { allSeason: true, perDate: { "2026-12-05": 2, "2026-12-12": 1 } } });
  }, 120_000);
});
