import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { registerOrgTeam, withdrawOrgTeam } from "./org-leagues";
import { createOrganization } from "./org-signup";
import { createOrgTeam, deleteOrgTeam } from "./org-teams";
import { addDivision, saveProgram } from "./scenic-programs";
import { decideRemoval, deleteBlock, removalRequests, requestRemoval } from "./schedule-removal";
import { SCHEDULED_REFUSAL } from "./team-guards";
import { createTestDb, grant } from "./testing/db";

const ALL = { allSeason: true, days: [] };
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
const dee = person("9913694", "Dee"); // Scenic City Admin (Scheduler)
const org = "east-ridge-parks-and-rec";

describe("removal from an event's schedule", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const now = new Date("2026-11-02T15:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  let pid = "";

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jo', 'X', '4235550001'), ('9913694', 'Dee', 'X', '4239913694')",
    );
    await grant(db.pool, "9913694 scenic-city Director", "9913694 scenic-city Admin");
    await createOrganization(
      deps(),
      jo,
      { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e", features: ["court-club"] },
      null,
    );
    await db.pool.query("insert into org_features (org, feature, source, turned_on_by) values ($1, 'court-sync', 'setup', 'test') on conflict do nothing", [org]);
    pid = (
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
  });

  const team = async () =>
    ((await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: ["4"], level: "REC" })) as { id: string }).id;
  const copyOf = async (tid: string) => (await db.pool.query<{ id: string }>("select id::text from scenic_teams where org_team_id = $1", [tid])).rows[0].id;
  const game = async (day: string, a: string, b: string | null, home: "a" | "b" | null = "a") => {
    const [x, y] = b && Number(b) < Number(a) ? [b, a] : [a, b];
    const side = home && b && x !== a ? (home === "a" ? "b" : "a") : home; // home given for `a`
    await db.pool.query(
      `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, home_side, created_by)
       select $1, d.id, $2, $3, $4, $5, 't' from scenic_divisions d where d.program_id = $1`,
      [pid, day, x, y, side],
    );
  };

  it("a scheduled team asks; the Scheduler approves: TBD in its games, withdrawn, then it can be deleted", async () => {
    const [t1, t2] = [await team(), await team()];
    expect(await registerOrgTeam(deps(), jo, org, t1, pid, ALL)).toMatchObject({ ok: true });
    expect(await registerOrgTeam(deps(), jo, org, t2, pid, ALL)).toMatchObject({ ok: true });
    const [c1, c2] = [await copyOf(t1), await copyOf(t2)];

    // Registered, not scheduled: delete says withdraw first.
    expect(await deleteBlock(db.pool, "org", t1, now)).toEqual({ why: "registered", program: "Winter League 2027" });
    expect(await requestRemoval(deps(), jo, pid, c1)).toMatchObject({ ok: false, message: expect.stringMatching(/simply withdraw/) });

    // On the schedule: t1 home vs t2 on Jan 9, and t1 vs TBD on Jan 16.
    await game("2027-01-09", c1, c2, "a");
    await game("2027-01-16", c1, null);
    expect(await withdrawOrgTeam(deps(), jo, org, t1, pid)).toEqual({ ok: false, message: SCHEDULED_REFUSAL });
    expect(await deleteBlock(db.pool, "org", t1, now)).toMatchObject({ why: "scheduled", programId: pid, teamId: c1, requested: null });

    // Only whoever manages the team asks (once).
    expect(await requestRemoval(deps(), dee, pid, c1)).toMatchObject({ ok: false });
    expect(await requestRemoval(deps(), jo, pid, c1)).toEqual({ ok: true });
    expect(await requestRemoval(deps(), jo, pid, c1)).toEqual({ ok: true });
    const list = await removalRequests(db.pool, pid);
    expect(list).toMatchObject([{ teamId: c1, games: 2, by: "Jo X" }]);
    expect(await deleteBlock(db.pool, "org", t1, now)).toMatchObject({ why: "scheduled", requested: { by: "Jo X" } });

    // Only the Scheduler decides; t2 already playing TBD that day stops it (nothing changed).
    expect(await decideRemoval(deps(), jo, list[0].id, true)).toMatchObject({ ok: false });
    await game("2027-01-09", c2, null);
    expect(await decideRemoval(deps(), dee, list[0].id, true)).toMatchObject({ ok: false, message: expect.stringMatching(/already plays TBD/) });
    await db.pool.query("delete from scenic_matchups where team_b is null and team_a = $1", [c2]);

    expect(await decideRemoval(deps(), dee, list[0].id, true)).toEqual({ ok: true, games: 2 });
    const games = await db.pool.query("select day::text, team_a::text, team_b, home_side from scenic_matchups order by day");
    // t2 now plays TBD on Jan 9, away as before (TBD home); t1's game against TBD is gone.
    expect(games.rows).toEqual([{ day: "2027-01-09", team_a: c2, team_b: null, home_side: "b" }]);
    expect((await db.pool.query("select 1 from scenic_registrations where team_id = $1", [c1])).rowCount).toBe(0);
    expect(await removalRequests(db.pool, pid)).toEqual([]);
    expect(await decideRemoval(deps(), dee, list[0].id, false)).toMatchObject({ ok: false, message: "That request was already decided." });
    expect(await deleteBlock(db.pool, "org", t1, now)).toBeNull();
    expect(await deleteOrgTeam(deps(), jo, org, t1)).toEqual({ ok: true });
  }, 120_000);

  it("Decline leaves the team on the schedule", async () => {
    const [t1, t2] = [await team(), await team()];
    await registerOrgTeam(deps(), jo, org, t1, pid, ALL);
    await registerOrgTeam(deps(), jo, org, t2, pid, ALL);
    const [c1, c2] = [await copyOf(t1), await copyOf(t2)];
    await game("2027-01-09", c1, c2);
    await requestRemoval(deps(), jo, pid, c1);
    const [r] = await removalRequests(db.pool, pid);
    expect(await decideRemoval(deps(), dee, r.id, false)).toEqual({ ok: true, games: 0 });
    expect((await db.pool.query("select count(*)::int n from scenic_matchups")).rows[0].n).toBe(1);
    expect(await deleteBlock(db.pool, "org", t1, now)).toMatchObject({ why: "scheduled", requested: null });
  }, 120_000);
});
