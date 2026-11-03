import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { recordVisit, visitStats } from "./site-visits";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: true,
});
const admin = person("5550001", "Al");
const coach = person("5550002", "Cy");
const staff = person("5550003", "Pam"); // CourtCaptain staff
// Tuesday Nov 3, 2026, 10 AM Eastern.
const NOW = new Date("2026-11-03T15:00:00Z");

describe("site visits", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Al', 'X', '4235550001'), ('5550002', 'Cy', 'X', '4235550002'), ('5550003', 'Pam', 'X', '4235550003')",
    );
    await grant(db.pool, "5550001 thunder Admin", "5550002 thunder Coach");
    await db.pool.query("insert into platform_admins (coach_id, granted_by) values ('5550003', 'test')");
  });

  it("counts page views per person per hour; Today by hour, This Week and Month by day, This Year by month (Eastern)", async () => {
    const visit = (v: SessionUser, at: string, org = "thunder") =>
      recordVisit({ pool: db.pool, now: () => new Date(at) }, v, org);
    await visit(coach, "2026-11-03T14:05:00Z"); // 9 AM today
    await visit(coach, "2026-11-03T14:55:00Z"); // same hour
    await visit(admin, "2026-11-03T15:00:00Z"); // 10 AM today
    await visit(coach, "2026-11-03T04:30:00Z"); // Nov 2, 11:30 PM Eastern: this week, not today
    await visit(coach, "2026-11-01T15:00:00Z"); // Sunday: this month, last week
    await visit(coach, "2026-02-10T15:00:00Z"); // this year
    await visit(coach, "2025-12-31T15:00:00Z"); // last year
    await visit(staff, "2026-11-03T15:00:00Z"); // CourtCaptain staff: not counted
    await recordVisit({ pool: db.pool, now: () => NOW }, { ...coach, actingBy: { coachId: "5550001", name: "Al X" } }, "thunder"); // View As
    await visit(coach, "2026-11-03T15:00:00Z", "scenic-city"); // another organization

    expect(await visitStats({ pool: db.pool, now: () => NOW }, coach, "thunder")).toBeNull(); // Owners and Admins only
    const s = (await visitStats({ pool: db.pool, now: () => NOW }, admin, "thunder"))!;
    expect(s.today).toMatchObject({ views: 3, people: 2 });
    expect(s.today.buckets).toHaveLength(24);
    expect(s.today.buckets.filter((b) => b.n)).toEqual([
      { start: "2026-11-03T09:00", n: 2 },
      { start: "2026-11-03T10:00", n: 1 },
    ]);
    expect(s.week).toMatchObject({ views: 4, people: 2 });
    expect(s.week.buckets.map((b) => b.n)).toEqual([1, 3, 0, 0, 0, 0, 0]); // Mon–Sun
    expect(s.month).toMatchObject({ views: 5 });
    expect(s.month.buckets).toHaveLength(30);
    expect(s.year).toMatchObject({ views: 6, people: 2 });
    expect(s.year.buckets.map((b) => b.n)).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0]);
  });
});
