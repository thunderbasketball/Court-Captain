import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { saveScore, scoreGames } from "./scores";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false }) as SessionUser;
const hal = person("5550401", "Hal"); // the host organization's Director of Scores
const sam = person("5550402", "Sam"); // nobody
const dee = person("9913694", "Dee"); // Scenic City Admin (the League's)

describe("scores and the Power Index", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());

  it("a Director of Scores of the gym's organization (or the League's) enters it on or after the day; PIs follow", async () => {
    const now = new Date("2026-12-06T17:00:00Z");
    const deps = { pool: db.pool, now: () => now };
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550401', 'Hal', 'X', '4235550401'), ('5550402', 'Sam', 'X', '4235550402'),
         ('9913694', 'Dee', 'X', '4239913694')`,
    );
    await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('host', 'Host Rec', 'Host', 'Organization')");
    await db.pool.query("insert into org_role_types (org, role) values ('host', 'Director') on conflict do nothing");
    await grant(db.pool, "5550401 host Director", "9913694 scenic-city Admin");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('5550401', 'host', 'scores', 'test')");
    const gym = (await db.pool.query<{ id: string }>("insert into gyms (name, org) values ('Host Gym', 'host') returning id::text")).rows[0].id;
    const court = (await db.pool.query<{ id: string }>("insert into courts (gym_id, name) values ($1, 'Main') returning id::text", [gym])).rows[0].id;
    const prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2026-12-31', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    const div = (
      await db.pool.query<{ id: string }>(`insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 4, 5) returning id::text`)
    ).rows[0].id;
    await db.pool.query(`insert into scenic_grade_groups (division_id, grade, level) values (${div}, 5, 'COMP')`);
    await db.pool.query("insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups");
    await db.pool.query(
      `insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, created_by, updated_by) values
         ('5B Aces', 'Boys', 5, 5, 'COMP', '5550402', 't', 't'), ('5B Bolts', 'Boys', 5, 5, 'COMP', '5550402', 't', 't')`,
    );
    await db.pool.query(`insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select ${prog}, t.id, (select id from scenic_pools), 't' from scenic_teams t`);
    const ids = (await db.pool.query<{ id: string; name: string }>("select id::text, name from scenic_teams order by id")).rows;
    const [aces, bolts] = ids.map((x) => x.id);
    // Dec 5 at Host Gym (Aces home), and Dec 12 (not played yet).
    const game = async (day: string, starts: string) =>
      (
        await db.pool.query<{ id: string }>(
          `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by, home_side, court_key, starts)
           values ($1, $2, $3, $4, $5, 't', 'a', $6, $7) returning id::text`,
          [prog, div, day, aces, bolts, `o${gym}-${court}`, starts],
        )
      ).rows[0].id;
    const dec5 = await game("2026-12-05", "10:00");
    const dec12 = await game("2026-12-12", "10:00");

    expect(await scoreGames(db.pool, sam, "host", now)).toBeNull();
    const list = (await scoreGames(db.pool, hal, "host", now))!;
    expect(list.map((g) => [g.day, g.home, g.away, g.gym, g.homeScore])).toEqual([["2026-12-05", "5B Aces", "5B Bolts", "Host Gym", null]]);

    expect(await saveScore(deps, sam, dec5, { home: "30", away: "20" })).toMatchObject({ ok: false });
    expect(await saveScore(deps, hal, dec12, { home: "30", away: "20" })).toEqual({ ok: false, message: "Scores go in on or after the Game Day." });
    expect(await saveScore(deps, hal, dec5, { home: "30", away: "30" })).toMatchObject({ ok: false }); // no ties
    expect(await saveScore(deps, hal, dec5, { home: "30", away: "" })).toMatchObject({ ok: false });
    expect(await saveScore(deps, hal, dec5, { home: "=1", away: "2" })).toMatchObject({ ok: false });
    expect(await saveScore(deps, hal, dec5, { home: "30", away: "20" })).toEqual({ ok: true });
    const pis = async () =>
      Object.fromEntries(
        (await db.pool.query<{ team: string; pi: number; wins: number; losses: number }>("select team_id::text as team, pi, wins, losses from scenic_pi")).rows.map(
          (r) => [r.team, r],
        ),
      );
    let p = await pis();
    expect(p[aces]).toMatchObject({ wins: 1, losses: 0 });
    expect(p[aces].pi).toBeGreaterThan(500);
    expect(p[bolts].pi).toBeLessThan(500);
    expect((await scoreGames(db.pool, hal, "host", now))![0]).toMatchObject({ homeScore: 30, awayScore: 20, scoredBy: "Hal X" });

    // The League's Admin too; a forfeit (Aces forfeited); then cleared: back to 500.
    expect(await saveScore(deps, dee, dec5, { forfeit: "home" })).toEqual({ ok: true });
    p = await pis();
    expect(p[bolts]).toMatchObject({ wins: 1, losses: 0 });
    expect((await scoreGames(db.pool, hal, "host", now))![0]).toMatchObject({ forfeit: "home", homeScore: null });
    expect(await saveScore(deps, hal, dec5, { home: "", away: "" })).toEqual({ ok: true });
    p = await pis();
    expect([p[aces].pi, p[bolts].pi, p[aces].wins]).toEqual([500, 500, 0]);
  }, 120_000);
});
