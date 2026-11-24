import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, grant } from "./testing/db";
import { HEADER, row } from "./teamsnap/fixtures";
import { importRegistrations } from "./teamsnap/import";
import { parseRegistrations } from "./teamsnap/parse";
import { importTeams, parseTeamsTab } from "./teams-import";

const H = ["Grade", "GRAD", "Gender", "TeamID", "Level", "CoachID", "AsstID", "ManagerID", "ParentID", "Practice Locations"];
const tab = (...rows: string[][]) => [H, ...rows];

describe("parseTeamsTab", () => {
  it("reads teams, staff and locations", () => {
    const r = parseTeamsTab(tab(["4th", "2035", "Girls", "4G Epps", "REC", "9913694", "", "9023694", "", "Action Church, East Ridge MS"]));
    expect(r.errors).toEqual([]);
    expect(r.teams).toEqual([
      {
        row: 2,
        name: "4G Epps",
        gender: "Girls",
        grades: ["4"],
        level: "REC",
        staff: [
          { role: "HeadCoach", coachId: "9913694" },
          { role: "Manager", coachId: "9023694" },
        ],
        practiceLocations: ["Action Church", "East Ridge MS"],
      },
    ]);
  });

  it("warns when the name and grade disagree, and when there's no head coach", () => {
    const r = parseTeamsTab(tab(["7th", "", "Girls", "8G Black", "COMP", "3554447"], ["K", "", "Boys", "KB None", "REC", ""]));
    expect(r.warnings.map((w) => w.message)).toEqual([
      "Name says 8G but the row says 7th Grade Girls. Imported as 7th Grade.",
      "No head coach (CoachID).",
    ]);
    expect(r.teams.map((t) => t.grades)).toEqual([["7"], ["K"]]);
  });

  it("errors on bad rows, duplicates and formula-looking names", () => {
    const r = parseTeamsTab(
      tab(
        ["4th", "", "Girls", "4G A", "REC", "1111111"],
        ["4th", "", "Girls", "4G A", "REC", "1111111"],
        ["4th", "", "Coed", "4X B", "REC", "1111111"],
        ["4th", "", "Girls", "4G C", "PRO", "1111111"],
        ["4th", "", "Girls", "=HYPERLINK()", "REC", "1111111"],
      ),
    );
    expect(r.errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
  });
});

describe("importTeams", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => {
    await db?.drop();
  });
  const now = new Date("2026-10-28T12:00:00Z");
  const opts = { by: "Earl Epps", now, dryRun: false };

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Earl', 'Epps', '4239913694')",
    );
    await grant(db.pool, "9913694 thunder Director");
    // Parent 1 Pat Test, cell 4235550000 -> CoachID 5550000.
    const csv = parseRegistrations([HEADER, row({ rid: "1" })].join("\n"), { schoolYear: 2026 });
    await importRegistrations(db.pool, csv, "Earl Epps", now);
  });

  const sheet = tab(
    ["4th", "", "Girls", "4G Epps", "REC", "9913694", "5550000", "9023694", "", "Action Church"],
    ["2nd", "", "Boys", "2B Test", "COMP", "5550000"],
  );
  const staff = async () =>
    (await db.pool.query("select t.name, s.coach_id, s.role from team_staff s join teams t on t.id = s.team_id order by t.name, s.role"))
      .rows;

  it("creates teams, matches users, creates logins from registration, lists the unmatched", async () => {
    const out = await importTeams(db.pool, parseTeamsTab(sheet), opts);
    expect(out[0].staff.map((s) => s.status)).toEqual(["user", "newLogin", "unmatched"]);
    expect(out[1].staff.map((s) => s.status)).toEqual(["user"]); // Pat's login was made for 4G Epps
    expect(await staff()).toEqual([
      { name: "2B Test", coach_id: "5550000", role: "HeadCoach" },
      { name: "4G Epps", coach_id: "5550000", role: "AsstCoach" },
      { name: "4G Epps", coach_id: "9913694", role: "HeadCoach" },
    ]);
    const u = await db.pool.query(`select first_name, cell, email, pin_hash, has_role(coach_id, 'thunder', 'Coach') as thunder_coach from users where coach_id = '5550000'`);
    expect(u.rows[0]).toEqual({ first_name: "Pat", cell: "4235550000", email: "pat@example.com", pin_hash: null, thunder_coach: true });
    const t = await db.pool.query("select practice_locations, created_by from teams where name = '4G Epps'");
    expect(t.rows[0]).toEqual({ practice_locations: ["Action Church"], created_by: "Earl Epps" });
  });

  it("a dry run changes nothing", async () => {
    const out = await importTeams(db.pool, parseTeamsTab(sheet), { ...opts, dryRun: true });
    expect(out).toHaveLength(2);
    expect((await db.pool.query("select count(*)::int n from teams")).rows[0].n).toBe(0);
    expect((await db.pool.query("select count(*)::int n from users")).rows[0].n).toBe(1);
  });

  it("running again keeps teams and adds staff who now exist", async () => {
    await importTeams(db.pool, parseTeamsTab(sheet), opts);
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('9023694', 'Mo', 'Manager', '4239023694')");
    const out = await importTeams(db.pool, parseTeamsTab(sheet), opts);
    expect(out.map((t) => t.status)).toEqual(["exists", "exists"]);
    expect(out[0].staff.map((s) => s.status)).toEqual(["already", "already", "user"]);
    expect((await db.pool.query("select count(*)::int n from teams")).rows[0].n).toBe(2);
    expect(await staff()).toContainEqual({ name: "4G Epps", coach_id: "9023694", role: "Manager" });
  });

  it("refuses a tab with errors", async () => {
    const bad = parseTeamsTab(tab(["4th", "", "Coed", "4X", "REC", "1"]));
    await expect(importTeams(db.pool, bad, opts)).rejects.toThrow(/nothing was changed/);
  });
});
