import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../auth/service";
import { createTestDb, grant } from "../testing/db";
import type { FastbreakClient } from "./client";
import { fastbreakPage, setFastbreakOrg, syncFastbreakNow } from "./orgs";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const dee = person("9913694", "Dee"); // Scenic City Director of Teams
const fay = person("5550004", "Fay"); // Scenic City Director of Facilities only

describe("FastBreak page", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const now = () => new Date("2026-11-20T15:00:00Z");
  const deps = () => ({ pool: db.pool, now });
  let baylor = "";

  const client: FastbreakClient = {
    events: async () => [
      { id: 2, name: "Week #01", type: "single-day", start: "2026-12-05", end: "2026-12-05", archived: false, sportId: 2 },
    ],
    teams: async () => [
      { id: 21, name: "Snakes", genderId: 1, grade: 5, organizationId: 500, organizationName: "Thunder Snakes", staff: [] },
      { id: 22, name: "Panthers", genderId: 1, grade: 5, organizationId: 600, organizationName: "Panthers", staff: [] },
    ],
  };

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Dee', 'X', '4239913694'), ('5550004', 'Fay', 'X', '4235550004')",
    );
    await grant(db.pool, "9913694 scenic-city Director", "5550004 scenic-city Director");
    await db.pool.query(
      `insert into director_areas (coach_id, org, area, granted_by) values
         ('9913694', 'scenic-city', 'teams', 'test'), ('5550004', 'scenic-city', 'facilities', 'test')`,
    );
    baylor = (
      await db.pool.query<{ id: string }>(
        `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values
           ('Signal Mountain', 'Organization', false, true, true, 'test') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      "insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values ('Thunder Basketball', 'Organization', true, true, true, 'test', 'thunder')",
    );
    const prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into game_days (day, created_by) values ('2026-12-05', 't');
       insert into program_game_days (program_id, game_day_id, added_by, kind) select ${prog}, id, 't', 'game' from game_days;
       insert into scenic_program_options (program_id, kind, fee_cents) values (${prog}, 'single_1', 4000);
       insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 5, 5);
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;`,
    );
  });

  it("only a Director of Teams sees it, picks clubs and syncs; a pick brings the teams in at the next sync", async () => {
    expect(await fastbreakPage(deps(), fay)).toBeNull();
    expect(await syncFastbreakNow({ ...deps(), client: () => client }, fay)).toMatchObject({ ok: false });
    expect(
      await syncFastbreakNow(
        {
          ...deps(),
          client: () => {
            throw new Error("Fastbreak isn't set up.");
          },
        },
        dee,
      ),
    ).toEqual({ ok: false, message: "Fastbreak isn't set up." });

    // First sync: "Thunder Snakes" looks like Thunder (skipped); Panthers waits.
    const first = await syncFastbreakNow({ ...deps(), client: () => client }, dee);
    expect(first).toMatchObject({ ok: true, report: { added: [], waiting: [{ org: "Panthers", teams: 1 }] } });
    let page = await fastbreakPage(deps(), dee);
    expect(page?.orgs.map((o) => [o.fbName, o.kind, o.teams, o.setBy])).toEqual([
      ["Panthers", "waiting", 1, null],
      ["Thunder Snakes", "skip", 1, "Fastbreak (auto)"],
    ]);
    expect(page?.sync).toMatchObject({ ok: true });

    // Fay can't pick; a bad id or a CourtCaptain name is refused.
    expect(await setFastbreakOrg(deps(), fay, "600", baylor)).toMatchObject({ ok: false });
    expect(await setFastbreakOrg(deps(), dee, "999", baylor)).toMatchObject({ ok: false });
    expect(await setFastbreakOrg(deps(), dee, "600", { name: "Thunder Basketball" })).toMatchObject({ ok: false });
    expect(await setFastbreakOrg(deps(), dee, "500", { name: "=bad" })).toMatchObject({ ok: false });

    // Panthers → Signal Mountain (already here); Thunder Snakes → a new club, with its Abbreviation.
    expect(await setFastbreakOrg(deps(), dee, "600", baylor)).toEqual({ ok: true });
    expect(await setFastbreakOrg(deps(), dee, "500", { name: "Thunder Snakes", abbr: "ts" })).toEqual({ ok: true });
    const again = await syncFastbreakNow({ ...deps(), client: () => client }, dee);
    expect(again).toMatchObject({
      ok: true,
      report: { added: ["SM 5B TBD (FB) · Signal Mountain", "TS 5B TBD (FB) · Thunder Snakes"], waiting: [] },
    });
    page = await fastbreakPage(deps(), dee);
    expect(page?.orgs.map((o) => [o.fbName, o.kind, o.clubName, o.added, o.setBy])).toEqual([
      ["Panthers", "club", "Signal Mountain", 1, "Dee X"],
      ["Thunder Snakes", "club", "Thunder Snakes", 1, "Dee X"],
    ]);
    expect(page?.teams.map((t) => [t.name, t.club, t.altName, t.days])).toEqual([
      ["SM 5B TBD (FB)", "Signal Mountain", "Panthers", ["2026-12-05"]],
      ["TS 5B TBD (FB)", "Thunder Snakes", "Snakes", ["2026-12-05"]],
    ]);
    expect((await db.pool.query("select created_by from partners where name = 'Thunder Snakes'")).rows).toEqual([
      { created_by: "Dee X" },
    ]);

    // Back to waiting: kept as picked by Dee; the team already added stays.
    expect(await setFastbreakOrg(deps(), dee, "500", "waiting")).toEqual({ ok: true });
    page = await fastbreakPage(deps(), dee);
    expect(page?.orgs[0]).toMatchObject({ fbName: "Thunder Snakes", kind: "waiting", setBy: "Dee X" });
    expect(page?.teams).toHaveLength(2);
  }, 60_000);
});
