import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { canSetTeamLogo, leagueTeamRef, setTeamLogo, teamLogo } from "./team-logos";
import { createTestDb, grant } from "./testing/db";

// A 1×1 PNG's first bytes are enough for the type check.
const PNG = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), type: "image/png" };
const who = (coachId: string) => ({ coachId, firstName: "T", lastName: coachId, isDirector: false }) as unknown as SessionUser;

describe("A team's own logo", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const one = async (sql: string, p: unknown[] = []) => (await db.pool.query<{ id: string }>(sql, p)).rows[0]?.id;
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-28T15:00:00Z") });

  it("its Head Coach or Team Manager, or its organization's Directors of Teams, set it; others can't; League pictures find it", async () => {
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'He', 'A', '4235550001'), ('5550002', 'As', 'B', '4235550002'),
       ('5550003', 'Ma', 'C', '4235550003'), ('5550004', 'Di', 'D', '4235550004'), ('5550005', 'So', 'E', '4235550005')`,
    );
    await grant(db.pool, "5550004 thunder Admin");
    const thunder = await one("insert into teams (name, gender, grades, grade_sort, level, created_by) values ('5B T', 'Boys', '{5}', 5, 'REC', 't') returning id::text");
    await db.pool.query(
      "insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 't'), ($1, '5550002', 'AsstCoach', 't'), ($1, '5550003', 'Manager', 't')",
      [thunder],
    );
    const t = thunder!;
    expect(await canSetTeamLogo(db.pool, who("5550001"), "thunder", t)).toBe(true); // Head Coach
    expect(await canSetTeamLogo(db.pool, who("5550003"), "thunder", t)).toBe(true); // Team Manager
    expect(await canSetTeamLogo(db.pool, who("5550004"), "thunder", t)).toBe(true); // an Admin (every area)
    expect(await canSetTeamLogo(db.pool, who("5550002"), "thunder", t)).toBe(false); // an Assistant Coach
    expect(await setTeamLogo(deps(), who("5550002"), "thunder", t, PNG)).toMatchObject({ ok: false });
    expect(await setTeamLogo(deps(), who("5550001"), "thunder", t, { bytes: new Uint8Array([1, 2, 3]), type: "image/png" })).toMatchObject({
      ok: false,
      message: /PNG, JPEG or WebP/,
    });
    expect(await setTeamLogo(deps(), who("5550001"), "thunder", t, PNG)).toEqual({ ok: true });
    expect((await teamLogo(db.pool, who("5550002"), "thunder", t))).toMatchObject({ logo: expect.stringMatching(new RegExp(`^/team-logo/t-${t}\\?v=\\d+$`)), canSet: false });

    // Its League copy uses the same logo; a Solo League team keeps its own, set by its coach.
    const league = await one(
      `insert into scenic_teams (name, gender, grade_low, grade, level, coach_id, owner_coach_id, thunder_team_id, created_by, updated_by)
       values ('5B T', 'Boys', 5, 5, 'REC', '5550001', '5550001', $1, 't', 't') returning id::text`,
      [t],
    );
    expect(await leagueTeamRef(db.pool, league!)).toEqual({ kind: "thunder", id: t });
    const solo = await one(
      `insert into scenic_teams (name, gender, grade_low, grade, level, coach_id, owner_coach_id, created_by, updated_by)
       values ('5B Solo', 'Boys', 5, 5, 'REC', '5550005', '5550005', 't', 't') returning id::text`,
    );
    expect(await leagueTeamRef(db.pool, solo!)).toEqual({ kind: "league", id: solo });
    expect(await setTeamLogo(deps(), who("5550001"), "league", solo, PNG)).toMatchObject({ ok: false });
    expect(await setTeamLogo(deps(), who("5550005"), "league", solo, PNG)).toEqual({ ok: true });
    // A League copy can't be given its own (it's set on the team it comes from).
    expect(await canSetTeamLogo(db.pool, who("5550001"), "league", league!)).toBe(false);

    // Removed.
    expect(await setTeamLogo(deps(), who("5550003"), "thunder", t, null)).toEqual({ ok: true });
    expect((await teamLogo(db.pool, who("5550003"), "thunder", t)).logo).toBeNull();
  });
});
