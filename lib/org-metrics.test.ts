import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startSession, type SessionUser } from "./auth/service";
import { orgMetrics } from "./org-metrics";
import { createOrganization } from "./org-signup";
import { createOrgTeam } from "./org-teams";
import { createTestDb } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const admin = person("5550001", "Al");
const director = person("5550002", "Di");
// Tuesday Nov 3, 2026, 10 AM Eastern.
const NOW = new Date("2026-11-03T15:00:00Z");

describe("Home metrics", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => NOW });

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Al', 'X', '4235550001'),
         ('5550002', 'Di', 'X', '4235550002'), ('5550003', 'Cy', 'Coach', '4235550003'), ('5550004', 'Bo', 'Coach', '4235550004')`,
    );
    await db.pool.query(
      "select set_role('5550001', 'thunder', 'Admin', true, 'test'), set_role('5550002', 'thunder', 'Director', true, 'test')",
    );
  });

  it("Thunder: registrations and their daily trend, teams, players not on a team, uniforms, practices, coaches, waiting", async () => {
    const reg = (id: string, gender: string, grade: string, at: string, uniform = false) =>
      db.pool.query(
        `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw,
                                    imported_at, imported_by, registered_at, uniform_needed)
         values ($1, $1, 'P', $1, $2, $3, $4, 'x', '{}', now(), 'x', $5, $6)`,
        [id, gender, grade, grade === "K" ? 0 : Number(grade), at, uniform],
      );
    await reg("r1", "Boys", "5", "2026-11-03T02:00:00Z", true); // Nov 2, 9 PM Eastern
    await reg("r2", "Boys", "5", "2026-11-02T15:00:00Z");
    await reg("r3", "Girls", "K", "2026-10-20T15:00:00Z");
    await reg("r4", "Girls", "3", "2026-09-01T15:00:00Z"); // before the 30 days
    const team = async (name: string, gender: string, level: string) =>
      (
        await db.pool.query<{ id: string }>(
          "insert into teams (name, gender, grades, grade_sort, level, created_by) values ($1, $2, '{5}', 5, $3, 'x') returning id::text",
          [name, gender, level],
        )
      ).rows[0].id;
    const t1 = await team("5B Coach", "Boys", "COMP");
    const t2 = await team("3G TBD", "Girls", "REC");
    await db.pool.query(
      "insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550003', 'HeadCoach', 'x'), ($1, '5550004', 'AsstCoach', 'x')",
      [t1],
    );
    await db.pool.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       values ($1, 'r1', 'P', 'r1', 'Boys', '5', 5, 'x', now()), ($1, 'r2', 'P', 'r2', 'Boys', '5', 5, 'x', now())`,
      [t1],
    );
    await db.pool.query(
      "insert into team_uniforms (team_id, registrant_id, number, size, updated_by, updated_at) values ($1, 'r1', '12', null, 'x', now()), ($1, 'r2', '3', null, 'x', now())",
      [t1],
    );
    const gym = (await db.pool.query<{ id: string }>("insert into gyms (name) values ('Gym') returning id::text")).rows[0].id;
    const court = (
      await db.pool.query<{ id: string }>("insert into courts (gym_id, name) values ($1, 'A') returning id::text", [gym])
    ).rows[0].id;
    await db.pool.query(
      `insert into slots (court_id, starts_at, team_id, created_by, blackout) values
         ($1, '2026-11-04T22:00:00Z', $2, 'x', false), ($1, '2026-11-05T22:00:00Z', null, 'x', false),
         ($1, '2026-11-06T22:00:00Z', null, 'x', true), ($1, '2026-11-02T22:00:00Z', null, 'x', false),
         ($1, '2026-11-10T22:00:00Z', null, 'x', false)`,
      [court, t1],
    );
    await db.pool.query(
      "insert into blackouts (day, gym_id, created_by) values ('2026-11-26', null, 'x'), ('2026-11-26', $1, 'x'), ('2027-01-20', null, 'x')",
      [gym],
    );
    await db.pool.query("select set_role('5550002', 'thunder', 'Request', true, 'test')"); // a Director's request doesn't count
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550005', 'Ri', 'Q', '4235550005')");
    await db.pool.query("select set_role('5550005', 'thunder', 'Request', true, 'test')");
    await db.pool.query(
      "insert into support_questions (coach_id, org, question, asked_at, status) values ('5550003', 'thunder', 'Help', now(), 'new')",
    );
    // The Assistant Coach logged in yesterday; the Head Coach never has.
    await startSession({ ...deps(), now: () => new Date("2026-11-02T15:00:00Z") } as never, db.pool, "5550004");

    expect(await orgMetrics(deps(), director, "thunder")).toBeNull(); // Owners and Admins only
    const m = (await orgMetrics(deps(), admin, "thunder"))!;
    expect(m.registrations).toMatchObject({ total: 4, thisWeek: 2 });
    expect(m.registrations!.daily).toHaveLength(30);
    expect(m.registrations!.daily.at(-1)).toEqual({ day: "2026-11-03", n: 0 });
    expect(m.registrations!.daily.at(-2)).toEqual({ day: "2026-11-02", n: 2 }); // Eastern dates
    expect(m.registrations!.daily.find((d) => d.day === "2026-10-20")!.n).toBe(1);
    expect(m.teams).toEqual({ total: 2, rec: 1, comp: 1, boys: 1, girls: 1 });
    expect(m.notOnTeam).toEqual({
      total: 2,
      groups: [
        { label: "K Girls", n: 1 },
        { label: "3rd Girls", n: 1 },
      ],
    });
    expect(m.missing).toEqual([{ id: t2, name: "3G TBD", noCoach: true, noPlayers: true }]);
    expect(m.uniforms).toEqual({ players: 2, ready: 1, missing: 1 }); // r1 ordered a uniform and has no size
    expect(m.practices).toEqual({ thisWeek: { booked: 1, open: 1 }, nextWeek: { booked: 0, open: 1 }, blackoutDays: 1 });
    expect(m.coaches.map((c) => [c.name, c.teams, c.lastLogin?.toISOString() ?? null])).toEqual([
      ["Cy Coach", ["5B Coach"], null],
      ["Bo Coach", ["5B Coach"], "2026-11-02T15:00:00.000Z"],
    ]);
    expect(m.waiting).toEqual({ requests: 1, newChats: 1, workingChats: 0 });
  });

  it("another organization: only what its features have (teams and coaches; no registrations, uniforms or practices)", async () => {
    const org = "east-ridge-parks-and-rec";
    const input = { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e" };
    await createOrganization(deps(), admin, { ...input, features: ["team-building"] }, null);
    await createOrgTeam(deps(), admin, org, { gender: "Girls", grades: ["5"], level: "REC", headCoach: "none" } as Parameters<
      typeof createOrgTeam
    >[3]);
    const m = (await orgMetrics(deps(), admin, org))!;
    expect(m).toMatchObject({ registrations: null, notOnTeam: null, uniforms: null, practices: null });
    expect(m.teams).toEqual({ total: 1, rec: 1, comp: 0, boys: 0, girls: 1 });
    expect(m.missing.map((t) => [t.name, t.noCoach, t.noPlayers])).toEqual([["5G TBD", true, true]]);
    expect(await orgMetrics(deps(), director, org)).toBeNull();
  });
});
