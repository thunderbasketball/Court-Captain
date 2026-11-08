import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../testing/db";
import type { FastbreakClient, FbEvent, FbTeam } from "./client";
import { courtCaptainMatch, eventUse, syncFastbreak } from "./sync";

const ev = (id: number, type: string, start: string, end = start, more: Partial<FbEvent> = {}): FbEvent => ({
  id,
  name: `Event ${id}`,
  type,
  start,
  end,
  archived: false,
  sportId: 2,
  ...more,
});
const team = (id: number, org: [number, string], grade: number, genderId: number, coach?: [string, string, string?]): FbTeam => ({
  id,
  name: `FB Team ${id}`,
  genderId,
  grade,
  organizationId: org[0],
  organizationName: org[1],
  staff: coach
    ? [{ firstName: coach[0], lastName: coach[1], title: "Head Coach", phone: coach[2] ?? null, email: "Coach@Example.com" }]
    : [],
});

describe("Fastbreak → Scenic City League", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());

  let events: FbEvent[] = [];
  let teams: Record<number, FbTeam[]> = {};
  const client: FastbreakClient = { events: async () => events, teams: async (id) => teams[id] ?? [] };
  const deps = (now = "2026-11-20T15:00:00Z") => ({ pool: db.pool, now: () => new Date(now), client });
  let prog = "";
  let baylor = "";

  beforeEach(async () => {
    await db.reset();
    baylor = (
      await db.pool.query<{ id: string }>(
        `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values
           ('Baylor School', 'School', false, true, true, 'test') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values
         ('Thunder Basketball', 'Organization', true, true, true, 'test', 'thunder')`,
    );
    prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into game_days (day, created_by) values ('2026-12-05', 't'), ('2026-12-12', 't'), ('2026-12-19', 't'), ('2027-02-20', 't');
       insert into program_game_days (program_id, game_day_id, added_by, kind)
         select ${prog}, id, 't', case when day = '2027-02-20' then 'bracket' else 'game' end from game_days;
       insert into scenic_program_options (program_id, kind, fee_cents) values (${prog}, 'all_season', 25000), (${prog}, 'single_1', 4000);
       insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 4, 5), (${prog}, 'Girls', 4, 5);
       insert into scenic_grade_groups (division_id, grade, level)
         select d.id, g, l from scenic_divisions d, generate_series(4, 5) g, unnest(array['COMP', 'REC']) l
          where not (d.gender = 'Girls' and l = 'COMP' and g = 4);
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;`,
    );
    events = [
      ev(1, "super-event", "2026-12-05", "2027-02-28"), // ALL SEASON: ignored, teams are in each week
      ev(2, "single-day", "2026-12-05"),
      ev(3, "single-day", "2026-12-12"),
      ev(4, "single-day", "2026-12-19"),
      ev(5, "multi-day", "2027-02-20", "2027-02-28"), // Championship: not a Game Day
      ev(6, "single-day", "2026-12-19", "2026-12-19", { archived: true }),
    ];
    teams = {};
  });

  it("matches organizations on CourtCaptain by name or initials, not by a shared place word", () => {
    const cc = [{ name: "Thunder Basketball" }, { name: "East Hamilton Youth Assiation" }, { name: "City of Chattanooga" }];
    expect(courtCaptainMatch("Thunder 36B Hicks", cc)).toBe("Thunder Basketball");
    expect(courtCaptainMatch("ER Thunder", cc)).toBe("Thunder Basketball");
    expect(courtCaptainMatch("EHYA", cc)).toBe("East Hamilton Youth Assiation");
    expect(courtCaptainMatch("Chattanooga Christian School", cc)).toBeNull();
    expect(courtCaptainMatch("Thunderbolts", cc)).toBeNull();
  });

  it("uses only single-day events on the League's Game Days", () => {
    const winter = { id: "1", name: "Winter", gameDays: ["2026-12-05", "2026-12-12", "2026-12-19"] };
    expect(eventUse(events[0], [winter])).toBeNull(); // ALL SEASON
    expect(eventUse(events[2], [winter])).toEqual({ program: winter, day: "2026-12-12" });
    expect(eventUse(events[4], [winter])).toBeNull(); // Championship
    expect(eventUse(events[5], [winter])).toBeNull(); // archived
    expect(eventUse(ev(9, "single-day", "2026-12-26"), [winter])).toBeNull(); // not a Game Day
  });

  it("adds outside clubs' teams as COMP (FB) for their dates; skips CourtCaptain; others wait; safe to run again", async () => {
    const bay: [number, string] = [100, "baylor school"];
    teams[1] = [team(11, bay, 5, 1, ["Lee", "Harris", "(423) 555-0005"]), team(18, bay, 5, 1)]; // ALL SEASON: ignored
    teams[2] = [
      team(11, bay, 5, 1, ["Lee", "Harris", "(423) 555-0005"]),
      team(12, bay, 5, 2, ["Ann", "Cole"]),
      team(19, bay, 4, 1),
    ];
    teams[3] = [team(12, bay, 5, 2, ["Ann", "Cole"]), team(13, bay, 4, 1), team(14, [200, "Thunder 36B Hicks"], 5, 1)];
    teams[4] = [team(15, [300, "Hixson Hoops"], 5, 2), team(16, bay, 5, 3), team(17, bay, 4, 2)];

    // A dry run changes nothing.
    const dry = await syncFastbreak(deps(), { dryRun: true });
    expect(dry).toMatchObject({
      status: "done",
      report: { added: [expect.any(String), expect.any(String), expect.any(String), expect.any(String)] },
    });
    expect((await db.pool.query("select 1 from scenic_teams")).rowCount).toBe(0);
    expect((await db.pool.query("select 1 from fastbreak_orgs")).rowCount).toBe(0);

    const r = await syncFastbreak(deps());
    if (r.status !== "done") throw new Error(r.status);
    // "(FB)" after each name; two the same are numbered among the club's Fastbreak teams. Team 18 was only in ALL SEASON.
    expect(r.report.added).toEqual([
      "BS 4B TBD 1 (FB) · Baylor School",
      "BS 4B TBD 2 (FB) · Baylor School",
      "BS 5B Harris (FB) · Baylor School",
      "BS 5G Cole (FB) · Baylor School",
    ]);
    expect(r.report.registered).toEqual([
      "BS 4B TBD 1 (FB): Dec 12",
      "BS 4B TBD 2 (FB): Dec 5",
      "BS 5B Harris (FB): Dec 5",
      "BS 5G Cole (FB): Dec 5, Dec 12",
    ]);
    expect(r.report.onCourtCaptain).toEqual([{ org: "Thunder 36B Hicks", teams: 1 }]);
    expect(r.report.waiting).toEqual([{ org: "Hixson Hoops", teams: 1 }]);
    // Girls 4th has no COMP group; Boys & Girls can't be COMP.
    expect(r.report.problems).toEqual([
      expect.stringMatching(/^FB Team 17 \(baylor school\): This program has no Girls 4.* COMP\.$/),
      "FB Team 16 (baylor school): Boys & Girls teams can't be COMP.",
    ]);
    // Nothing is left behind for a team that couldn't be registered.
    expect((await db.pool.query("select 1 from scenic_teams where fastbreak_id = 17")).rowCount).toBe(0);

    const rows = await db.pool.query(
      `select t.name, t.level, t.alt_name, t.created_by, t.coach_id is not null as login, t.coach_first, t.fastbreak_id::int as fb,
              r.all_season, r.registered_by,
              array(select to_char(g.day, 'MM-DD') from scenic_registration_days d join game_days g on g.id = d.game_day_id
                     where d.team_id = t.id order by g.day) as days
       from scenic_teams t left join scenic_registrations r on r.team_id = t.id order by t.name`,
    );
    const row = (name: string, fb: number, login: boolean, coach: string | null, days: string[]) => ({
      name,
      level: "COMP",
      alt_name: `FB Team ${fb}`,
      created_by: "Fastbreak",
      login,
      coach_first: coach,
      fb,
      all_season: false,
      registered_by: "Fastbreak",
      days,
    });
    expect(rows.rows).toEqual([
      row("BS 4B TBD 1 (FB)", 13, false, null, ["12-12"]),
      row("BS 4B TBD 2 (FB)", 19, false, null, ["12-05"]),
      row("BS 5B Harris (FB)", 11, true, null, ["12-05"]),
      row("BS 5G Cole (FB)", 12, false, "Ann", ["12-05", "12-12"]),
    ]);
    // Ann Cole has no cell in Fastbreak: the team waits for one, named for her. The coach with a cell got a login, with Fastbreak's email.
    expect((await db.pool.query("select email from users where last_name = 'Harris'")).rows).toEqual([
      { email: "coach@example.com" },
    ]);
    expect(
      (await db.pool.query("select fb_name, skip, partner_id::text as p, set_by from fastbreak_orgs order by fb_org_id")).rows,
    ).toEqual([
      { fb_name: "baylor school", skip: false, p: baylor, set_by: "Fastbreak (auto)" },
      { fb_name: "Thunder 36B Hicks", skip: true, p: null, set_by: "Fastbreak (auto)" },
      { fb_name: "Hixson Hoops", skip: false, p: null, set_by: null },
    ]);
    expect((await db.pool.query("select ok, message from sync_status where name = 'fastbreak'")).rows[0]).toMatchObject({
      ok: true,
    });

    // Again, with one more week for a team: only what's new; nothing added twice.
    teams[4].push(team(13, bay, 4, 1));
    const again = await syncFastbreak(deps());
    expect(again).toMatchObject({ status: "done", report: { added: [], registered: ["BS 4B TBD 1 (FB): Dec 19"] } });

    // Once Hixson Hoops is picked as a club, its team comes in. Past Game Days are left out.
    const hh = (
      await db.pool.query<{ id: string }>(
        "insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, abbr) values ('Hixson Hoops', 'Organization', false, true, true, 't', 'HH') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query("update fastbreak_orgs set partner_id = $1, set_by = 'Dee X' where fb_org_id = 300", [hh]);
    teams[2].push(team(15, [300, "Hixson Hoops"], 5, 2));
    const later = await syncFastbreak(deps("2026-12-08T15:00:00Z"));
    expect(later).toMatchObject({
      status: "done",
      report: { added: ["HH 5G TBD (FB) · Hixson Hoops"], registered: ["HH 5G TBD (FB): Dec 19"] },
    });
  }, 60_000);
});
