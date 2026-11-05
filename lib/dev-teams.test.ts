import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { setSimulation, simulatedTeams } from "./dev-teams";
import { addDivision, saveProgram } from "./scenic-programs";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const dee = person("9913694", "Dee"); // Scenic City Director of Programs and of Scheduling

// A small seeded random, so the test always gets the same simulated teams.
function seeded(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

describe("Simulation mode", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = (seed: number) => ({ pool: db.pool, now: () => new Date("2026-11-02T15:00:00Z"), random: seeded(seed) });

  it("makes (DEV) teams with coaches; some coach 2 or 3 of their organization's teams in different grades", async () => {
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Dee', 'X', '4239913694')");
    await grant(db.pool, "9913694 scenic-city Director");
    await db.pool.query(
      `insert into director_areas (coach_id, org, area, granted_by) values
         ('9913694', 'scenic-city', 'programs', 'test'), ('9913694', 'scenic-city', 'scheduling', 'test')`,
    );
    // Thunder's partner record (the migrations make one for each organization).
    await db.pool.query(
      `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug)
       select 'Thunder Basketball', 'Organization', true, true, true, 'test', 'thunder'
        where not exists (select 1 from partners where org_slug = 'thunder')
       on conflict do nothing`,
    );
    const pid = (
      (await saveProgram(deps(1), dee, null, {
        kind: "League",
        name: "Winter League 2027",
        startsOn: "2027-01-09",
        endsOn: "2027-03-06",
        regOpens: "2026-11-01",
        regCloses: "2026-12-15",
        fee: "$150",
      })) as { id: string }
    ).id;
    for (const gender of ["Boys", "Girls"]) await addDivision(deps(1), dee, pid, { gender, from: 2, to: 8, levels: ["REC"] });

    for (const seed of [1, 2, 3]) {
      const r = await setSimulation(deps(seed), dee, true);
      expect(r).toMatchObject({ ok: true });
      const teams = (
        await db.pool.query<{ name: string; grade: number; coach: string; partner: string }>(
          "select name, grade, coach_first || ' ' || coach_last as coach, partner_id::text as partner from scenic_teams",
        )
      ).rows;
      expect(teams.length).toBe((r as { teams: number }).teams);
      expect(teams.every((t) => t.name.endsWith("(DEV)") && t.coach)).toBe(true);
      const byCoach = new Map<string, typeof teams>();
      for (const t of teams) byCoach.set(t.coach, [...(byCoach.get(t.coach) ?? []), t]);
      // Coaches with more than one team: 2 or 3 teams, each a different grade.
      const shared = [...byCoach.values()].filter((list) => list.length > 1);
      if (teams.length >= 6) expect(shared.length).toBeGreaterThan(0);
      for (const list of shared) {
        expect(list.length).toBeLessThanOrEqual(3);
        expect(new Set(list.map((t) => t.grade)).size).toBe(list.length);
      }
    }
    expect(await setSimulation(deps(1), dee, false)).toEqual({ ok: true, teams: 0 });
    expect(await simulatedTeams(db.pool)).toBe(0);
  });
});
