import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { followedTeams, publicLeague, publicLeagues, publicPrograms, setSchedulePublished } from "./public-league";
import { listPrograms, setProgramLogo } from "./scenic-programs";
import { createTestDb, grant } from "./testing/db";

describe("public League page (no login)", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  const now = new Date("2026-12-01T15:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const user = (coachId: string): SessionUser =>
    ({ coachId, firstName: "Dee", lastName: "X", isDirector: true }) as unknown as SessionUser;
  let prog = "";
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('9913694', 'Dee', 'X', '4239913694'), ('5550002', 'Sam', 'Lee', '4235550002'), ('5550003', 'Bo', 'Fay', '4235550003')`,
    );
    await grant(db.pool, "9913694 scenic-city Director", "5550003 scenic-city Director");
    await db.pool.query(
      "insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'programs', 'test')",
    );
    prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
       values ('League', 'Spring', '2027-03-05', '2027-05-28', '2027-01-01', '2027-02-14', 't', 't'),
              ('Tournament', 'Classic', '2026-12-12', '2026-12-13', '2026-10-01', '2026-12-01', 't', 't');
       insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 5, 5);
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;
       insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, abbr)
         values ('Hixson Hoops', 'Organization', false, true, true, 't', 'HH');
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('Magic', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't'),
                ('Sim 1 (DEV)', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't'),
                ('Benched', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't');
       insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, coach_id, created_by, updated_by)
         select 'HH 5B Fay', 'Boys', 5, 5, 'COMP', id, '5550003', 't', 't' from partners;
       insert into scenic_registrations (program_id, team_id, pool_id, registered_by)
         select ${prog}, t.id, (select id from scenic_pools), 't' from scenic_teams t;
       update scenic_registrations set removed_by = 't' where team_id = (select id from scenic_teams where name = 'Benched');
       insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by, home_side)
         select ${prog}, (select id from scenic_divisions), '2026-12-05', least(a.id, b.id), greatest(a.id, b.id), 't',
                case when a.id < b.id then 'b' else 'a' end
           from scenic_teams a, scenic_teams b where a.name = 'Magic' and b.name = 'HH 5B Fay';
       insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by)
         select ${prog}, (select id from scenic_divisions), '2026-12-05', a.id, null, 't' from scenic_teams a where a.name = 'Sim 1 (DEV)';`,
    );
  });

  it("lists Leagues with registration open, shows teams (no DEV, no sitting out, no contact) and the schedule once published", async () => {
    expect((await publicLeagues(db.pool, now)).map((l) => l.name)).toEqual(["Winter"]); // Spring not open yet; no Tournaments
    // The login page's Programs list has every kind; a Tournament has teams but no schedule.
    expect((await publicPrograms(db.pool, now)).map((l) => `${l.kind} ${l.name}`)).toEqual(["League Winter", "Tournament Classic"]);
    const classic = (await publicPrograms(db.pool, now)).find((l) => l.name === "Classic")!;
    expect(await publicLeague(db.pool, now, classic.id)).toMatchObject({ kind: "Tournament", groups: [], schedule: null });
    const before = await publicLeague(db.pool, now, prog);
    expect(before?.groups).toEqual([
      {
        label: "5th Boys COMP",
        teams: [
          { id: expect.any(String), name: "HH 5B Fay", tag: "HH" },
          { id: expect.any(String), name: "Magic", tag: "Solo" },
        ],
      },
    ]);
    expect(before?.schedule).toBeNull(); // not published yet
    expect(JSON.stringify(before)).not.toMatch(/4235550|Sam|Lee/); // no coach names or cells

    // Only a Director of Programs publishes.
    expect(await setSchedulePublished(deps(), user("5550003"), prog, true)).toMatchObject({ ok: false });
    expect(await setSchedulePublished(deps(), user("9913694"), prog, true)).toEqual({ ok: true });
    const after = await publicLeague(db.pool, now, prog);
    expect(after?.schedule).toEqual([
      {
        date: "2026-12-05",
        games: [
          {
            starts: null,
            gym: null,
            court: null,
            map: null, // not placed on the Grid yet
            group: "5th Boys COMP",
            home: "HH 5B Fay",
            away: "Magic",
            homeId: expect.any(String),
            awayId: expect.any(String),
          },
        ],
      },
    ]);
    expect(await setSchedulePublished(deps(), user("9913694"), prog, false)).toEqual({ ok: true });
    expect((await publicLeague(db.pool, now, prog))?.schedule).toBeNull();
    expect(await publicLeague(db.pool, now, "999")).toBeNull();
  }, 60_000);

  it("a device's followed teams: name, roster (public names), group in each public program, games once published; DEV and unknown dropped", async () => {
    const ids = (await db.pool.query<{ id: string; name: string }>("select id::text, name from scenic_teams order by name")).rows;
    const id = (name: string) => ids.find((t) => t.name === name)!.id;
    const follow = [id("Magic"), "999999", id("Sim 1 (DEV)"), "x; drop", id("Magic"), id("HH 5B Fay")];
    const before = await followedTeams(db.pool, now, follow);
    expect(before).toEqual([
      { id: id("Magic"), name: "Magic", roster: null, programs: [{ id: prog, name: "Winter", group: "5th Boys COMP", games: null }] },
      { id: id("HH 5B Fay"), name: "HH 5B Fay", roster: null, programs: [{ id: prog, name: "Winter", group: "5th Boys COMP", games: null }] },
    ]);
    await setSchedulePublished(deps(), user("9913694"), prog, true);
    const [magic, fay] = await followedTeams(db.pool, now, follow);
    expect(magic.programs[0].games).toEqual([
      { date: "2026-12-05", starts: null, gym: null, court: null, map: null, opponent: "HH 5B Fay", home: false },
    ]);
    expect(fay.programs[0].games).toEqual([{ date: "2026-12-05", starts: null, gym: null, court: null, map: null, opponent: "Magic", home: true }]);
    // The whole schedule, games already played too (the device shows the next 21 days collapsed).
    expect((await followedTeams(db.pool, new Date("2026-12-07T15:00:00Z"), [id("Magic")]))[0].programs[0].games).toHaveLength(1);
    // An organization's team keeps a roster: first names and last initials, jerseys; never full last names.
    const ot = (
      await db.pool.query<{ id: string }>(
        "insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('scenic-city', 'Fay 5B', 'Boys', 5, 5, 'COMP', 't') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into org_team_players (team_id, first_name, last_name, grade, jersey, added_by) values ($1, 'Ava', 'lyons', 5, '12', 't'), ($1, 'Ben', 'Cole', 5, null, 't')`,
      [ot],
    );
    await db.pool.query("update scenic_teams set org_team_id = $1 where name = 'HH 5B Fay'", [ot]);
    const [withRoster] = await followedTeams(db.pool, now, [id("HH 5B Fay")]);
    expect(withRoster.roster).toEqual([
      { name: "Ava L.", jersey: "12" },
      { name: "Ben C.", jersey: null },
    ]);
    expect(JSON.stringify(withRoster)).not.toMatch(/lyons|Cole/);
    expect(await followedTeams(db.pool, now, "nope")).toEqual([]);
    expect(JSON.stringify(before)).not.toMatch(/4235550|Sam|Lee/);
  }, 60_000);

  it("a program's logo: only a Director of Programs sets it, images only, shown everywhere the program is", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    expect((await publicLeagues(db.pool, now))[0].logo).toBeNull();
    expect(await setProgramLogo(deps(), user("5550003"), prog, { bytes: png, type: "image/png" })).toMatchObject({ ok: false });
    expect(
      await setProgramLogo(deps(), user("9913694"), prog, { bytes: new Uint8Array([60, 115, 118, 103]), type: "image/png" }),
    ).toEqual({ ok: false, message: "The logo must be a PNG, JPEG or WebP image." });
    expect(await setProgramLogo(deps(), user("9913694"), prog, { bytes: new Uint8Array(600 * 1024), type: "image/png" })).toEqual(
      { ok: false, message: "The logo must be 512 KB or smaller." },
    );
    expect(await setProgramLogo(deps(), user("9913694"), prog, { bytes: png, type: "image/png" })).toEqual({ ok: true });
    const link = `/program-logo/${prog}?v=${Math.floor(now.getTime() / 1000)}`;
    expect((await publicLeagues(db.pool, now))[0].logo).toBe(link);
    expect((await listPrograms(deps(), user("9913694")))!.programs.find((p) => p.id === prog)?.logo).toBe(link);
    const row = await db.pool.query("select logo_type, logo_updated_by from scenic_programs where id = $1", [prog]);
    expect(row.rows[0]).toEqual({ logo_type: "image/png", logo_updated_by: "Dee X" });
    // Removed.
    expect(await setProgramLogo(deps(), user("9913694"), prog, null)).toEqual({ ok: true });
    expect((await publicLeagues(db.pool, now))[0].logo).toBeNull();
  }, 60_000);
});
