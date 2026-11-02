import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addDivision, getProgram, saveProgram } from "./scenic-programs";
import { listScenicTeams } from "./scenic-teams";
import { createTeam } from "./teams";
import { createTestDb, grant } from "./testing/db";
import { registerAllThunderTeams, thunderPrograms } from "./thunder-leagues";

const earl: SessionUser = {
  coachId: "9913694",
  firstName: "Earl",
  lastName: "Epps",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: true,
  thunderAreas: ["teams"],
};

describe("Thunder's teams in Scenic City programs", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  let now = new Date("2026-11-02T15:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  beforeEach(async () => {
    now = new Date("2026-11-02T15:00:00Z");
    await db.reset();
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Earl', 'Epps', '4239913694')",
    );
    await grant(db.pool, "9913694 scenic-city Director", "9913694 scenic-city Admin", "9913694 thunder Director");
  });

  it("registers all unregistered Thunder teams (as TB …), read-only in Scenic City", async () => {
    const pid = (
      (await saveProgram(deps(), earl, null, {
        kind: "League",
        name: "Winter",
        startsOn: "2027-01-09",
        endsOn: "2027-03-06",
        regOpens: "2026-11-01",
        regCloses: "2026-12-15",
        fee: "150",
      })) as { id: string }
    ).id;
    await addDivision(deps(), earl, pid, { gender: "Girls", from: 3, to: 4, levels: ["COMP"] });
    await createTeam(deps(), earl, { gender: "Girls", grades: ["4"], level: "COMP", headCoach: "user:9913694" });
    await createTeam(deps(), earl, { gender: "Boys", grades: ["6"], level: "REC", headCoach: "none" });

    expect((await thunderPrograms(deps(), earl))!.programs).toMatchObject([{ name: "Winter", registered: 0, unregistered: 2 }]);
    expect(await registerAllThunderTeams(deps(), { ...earl, thunderAreas: ["facilities"] }, pid)).toMatchObject({ ok: false });
    expect(await registerAllThunderTeams(deps(), earl, pid)).toEqual({
      ok: true,
      registered: ["4G Epps: Girls 3rd–4th · 4th COMP · Pool A"],
      skipped: ["6B TBD: This program has no Boys 6th REC."],
    });
    const scenic = (await listScenicTeams(deps(), earl, "Director"))!.teams;
    expect(scenic.map((t) => `${t.name} ${t.partnerName} ${t.canEdit}`)).toContain("TB 4G Epps Thunder Basketball false");
    expect(JSON.stringify(await getProgram(deps(), earl, pid))).toContain("TB 4G Epps");
    expect((await thunderPrograms(deps(), earl))!.programs).toMatchObject([{ registered: 1, unregistered: 1 }]);
  });
});
