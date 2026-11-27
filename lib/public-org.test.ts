import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { daysUntil, heroFor, hostGames, hostGyms, hostedPrograms, programCounts, type HeroInput } from "./public-org";
import { createTestDb } from "./testing/db";
import { orgGameDays } from "./org-game-days";

const base: HeroInput = {
  org: "east-ridge",
  today: "2026-11-24",
  own: [],
  seasons: [],
  leagues: [],
  teams: 0,
  counts: { teams: 0, divisions: 0, orgs: 0 },
  gyms: 0,
  hosting: false,
  players: false,
  recruiting: false,
  openable: false,
};
const winter = { id: "7", name: "Winter", regCloses: "2027-02-14", startsOn: "2026-12-05", endsOn: "2027-02-28", register: true };
const league = { name: "Winter", orgName: "Scenic City", startsOn: "2026-12-05" };

describe("the public page's banner", () => {
  it("a League taking teams: Register first, its numbers and the days to tip-off (across a clock change too)", () => {
    const h = heroFor({ ...base, org: "scenic-city", own: [winter], counts: { teams: 110, divisions: 8, orgs: 6 }, recruiting: true, openable: true });
    expect(h.line).toBe("Winter team registration is open through Feb 14.");
    expect(h.stats).toEqual([
      { value: 11, label: "days to tip-off" },
      { value: 110, label: "teams" },
      { value: 8, label: "divisions" },
      { value: 6, label: "organizations" },
    ]);
    expect(h.actions.map((a) => a.href)).toEqual(["/register-team/scenic-city?program=7", "#programs", "#officials"]);
    expect(daysUntil("2027-03-13", "2027-03-15")).toBe(2);
  });

  it("no Register button once it can't register, and no zeros or countdown once it has started", () => {
    const h = heroFor({ ...base, today: "2026-12-05", own: [{ ...winter, register: false }], counts: { teams: 1, divisions: 1, orgs: 0 }, openable: true });
    expect(h.line).toBe("Winter is under way.");
    expect(h.stats).toEqual([
      { value: 1, label: "team" },
      { value: 1, label: "division" },
    ]);
    expect(h.actions.map((a) => a.label)).toEqual(["Teams & standings"]);
  });

  it("player registration, teams in a League, a host with no teams, officials, and nothing yet", () => {
    expect(heroFor({ ...base, seasons: [{ name: "Spring", regCloses: "2027-03-31", startsOn: null }], leagues: [league], teams: 23, players: true }).line).toBe(
      "Spring registration is open through Mar 31.",
    );
    expect(heroFor({ ...base, seasons: [{ name: "Fall", regCloses: "2026-10-01", startsOn: null }], leagues: [league], teams: 23, players: true }).line).toBe(
      "23 teams playing in Scenic City Winter.",
    );
    const host = heroFor({ ...base, leagues: [league], gyms: 1, hosting: true, openable: true });
    expect(host.line).toBe("Home gym for Scenic City Winter games.");
    expect(host.stats.map((x) => x.label)).toEqual(["days to tip-off", "gym"]);
    expect(heroFor({ ...base, recruiting: true }).line).toMatch(/officials/);
    expect(heroFor(base)).toEqual({ line: "Programs, teams and schedules show here as they're posted.", stats: [], actions: [] });
  });
});

describe("a host's public page (no login)", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  const now = new Date("2026-12-01T15:00:00Z");
  let prog = "";
  beforeAll(async () => {
    db = await createTestDb();
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550002', 'Sam', 'Lee', '4235550002');
       insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values ('Hixson Hoops', 'Organization', false, true, true, 't');`,
    );
    prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 5, 5);
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('Magic', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't'), ('Sim 1 (DEV)', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't'),
                ('Benched', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't');
       insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, coach_id, created_by, updated_by)
         select 'Hoops', 'Boys', 5, 5, 'COMP', id, '5550002', 't', 't' from partners;
       insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select ${prog}, t.id, (select id from scenic_pools), 't' from scenic_teams t;
       update scenic_registrations set removed_by = 't' where team_id = (select id from scenic_teams where name = 'Benched');
       insert into gyms (name, org, address) values ('Main Gym', 'thunder', '1 Court St'), ('Other Gym', 'scenic-city', '2 Court St');
       insert into gyms (name, org, active) values ('Closed Gym', 'thunder', false);
       insert into courts (gym_id, name) select id, 'Court 1' from gyms where name in ('Main Gym', 'Other Gym');`,
    );
  }, 180_000);
  afterAll(async () => db?.drop());

  const play = (gym: string, day: string) =>
    db.pool.query(
      `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by, home_side, court_key, starts)
       select $1, (select id from scenic_divisions), $3::date, least(a.id, b.id), greatest(a.id, b.id), 't', case when a.id < b.id then 'b' else 'a' end,
              (select 'o' || g.id || '-' || c.id from gyms g join courts c on c.gym_id = g.id where g.name = $2), '09:00'
         from scenic_teams a, scenic_teams b where a.name = 'Magic' and b.name = 'Hoops'`,
      [prog, gym, day],
    );

  it("its gyms and the Leagues it hosts only once approved; closed gyms and other organizations' gyms never", async () => {
    await db.pool.query("insert into org_partnerships (host_org, for_org, status, requested_by) values ('thunder', 'scenic-city', 'pending', 't')");
    expect(await hostGyms(db.pool, "thunder")).toEqual([]);
    expect(await hostedPrograms(db.pool, now, "thunder")).toEqual([]);
    await db.pool.query("update org_partnerships set status = 'approved'");
    expect(await hostGyms(db.pool, "thunder")).toEqual([{ name: "Main Gym", address: "1 Court St", map: null }]);
    expect((await hostedPrograms(db.pool, now, "thunder")).map((p) => p.name)).toEqual(["Winter"]);
    expect(await hostedPrograms(db.pool, new Date("2027-03-05T15:00:00Z"), "thunder")).toEqual([]); // ended
    expect(await hostGyms(db.pool, "scenic-city")).toEqual([]); // hosts for no one
  }, 60_000);

  it("games at its gyms: only published ones, only the coming day, only at its own gyms; no people", async () => {
    await play("Main Gym", "2026-12-05");
    await play("Main Gym", "2026-12-12");
    await play("Other Gym", "2026-12-04"); // sooner, and published, but another organization's gym
    expect(await hostGames(db.pool, now, "thunder")).toBeNull(); // not published
    await db.pool.query(
      `insert into scenic_published_schedules (program_id, day, level, published_by, published_at)
       values ($1, '2026-12-04', 'COMP', 't', now()), ($1, '2026-12-05', 'COMP', 't', now()), ($1, '2026-12-12', 'COMP', 't', now())`,
      [prog],
    );
    const day = await hostGames(db.pool, now, "thunder");
    expect(day).toEqual({
      date: "2026-12-05",
      games: [{ starts: "09:00", gym: "Main Gym", court: "Court 1", group: "5th Boys COMP", home: "Hoops", away: "Magic", final: null, hype: expect.any(String) }],
    });
    expect((await hostGames(db.pool, new Date("2026-12-06T15:00:00Z"), "thunder"))?.date).toBe("2026-12-12");
    expect(await hostGames(db.pool, new Date("2026-12-13T15:00:00Z"), "thunder")).toBeNull();
    expect(JSON.stringify(day)).not.toMatch(/4235550|Sam|Lee/);
  }, 60_000);

  it("Game Days card: each coming Game Day, games at its gyms once published, its gyms to print, the rules link", async () => {
    await db.pool.query("delete from scenic_published_schedules; delete from scenic_matchups");
    await db.pool.query("insert into game_days (day, created_by) values ('2026-12-05', 't') on conflict do nothing");
    await db.pool.query("insert into program_game_days (program_id, game_day_id, kind, added_by) select $1, id, 'game', 't' from game_days where day = '2026-12-05' on conflict do nothing", [prog]);
    expect(await orgGameDays(db.pool, "nobody", now)).toBeNull(); // no teams, no games at its gyms
    await play("Main Gym", "2026-12-05");
    let d = (await orgGameDays(db.pool, "thunder", now))!;
    expect(d.leagues).toEqual([{ id: prog, name: "Winter", rules: null, url: null }]);
    expect(d.days[0]).toMatchObject({ day: "2026-12-05", gyms: [{ name: "Main Gym", games: 1 }], atGyms: [], ours: [], waiting: 1 });
    await db.pool.query("insert into scenic_published_schedules (program_id, day, level, published_by, published_at) values ($1, '2026-12-05', 'COMP', 't', now())", [prog]);
    await db.pool.query("update scenic_programs set rules_url = 'https://docs.google.com/document/d/1_47RvmPehQM5Z2ZfmOcf11vvTg9j9jaLe93Bv2c11IA/edit' where id = $1", [prog]);
    d = (await orgGameDays(db.pool, "thunder", now))!;
    expect(d.days[0]).toMatchObject({ waiting: 0, atGyms: [{ home: "Hoops", away: "Magic", group: "5th Boys COMP", starts: "09:00", gym: "Main Gym" }] });
    expect(d.leagues[0].url).toMatch(/^https:\/\/docs\.google\.com\//);
    expect(JSON.stringify(d)).not.toMatch(/4235550|Sam|Lee/);
  }, 60_000);

  it("a program's numbers leave out simulated teams and teams sitting out; a stand-alone team isn't an organization", async () => {
    expect(await programCounts(db.pool, [prog])).toEqual({ teams: 2, divisions: 1, orgs: 1 });
    expect(await programCounts(db.pool, [])).toEqual({ teams: 0, divisions: 0, orgs: 0 });
  }, 60_000);
});
