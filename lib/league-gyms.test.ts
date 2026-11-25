import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leagueGyms, mergeGyms } from "./league-gyms";
import { createTestDb } from "./testing/db";

describe("a League's gyms", () => {
  const row = (key: string, name: string, host: string, address: string | null = null, courts = 1) => ({ key, name, host, address, lat: null, lng: null, place: null, courts });
  it("one gym two hosts share is listed once; the same name at two addresses is two gyms", () => {
    const g = mergeGyms(
      [row("o1", "Hamilton High", "Youth Assoc."), row("o2", "hamilton high ", "Hamilton HS", "1 Main St", 2), row("o3", "Rec Center", "A", "1 A St"), row("o4", "Rec Center", "B", "2 B St")],
      [{ key: "o1", day: "2026-12-12", n: 2 }, { key: "o2", day: "2026-12-12", n: 3 }, { key: "o2", day: "2026-12-05", n: 1 }],
    );
    expect(g.map((x) => [x.name, x.address, x.courts, x.hosts])).toEqual([
      ["Hamilton High", "1 Main St", 2, ["Hamilton HS", "Youth Assoc."]],
      ["Rec Center", "1 A St", 1, ["A"]],
      ["Rec Center", "2 B St", 1, ["B"]],
    ]);
    expect(g[0].days).toEqual([{ date: "2026-12-05", games: 1 }, { date: "2026-12-12", games: 5 }]);
  });

  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  it("an approved host's gyms marked for League games on its Game Days; dates only once published; no practice-only, closed or unapproved gym", async () => {
    const now = new Date("2026-12-01T15:00:00Z");
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550002', 'Sam', 'Lee', '4235550002')");
    const prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into organizations (slug, name, short_name, kind) values ('host', 'Host Rec', 'Host', 'Organization'), ('asker', 'Asker', 'Asker', 'Organization');
       insert into org_partnerships (host_org, for_org, status, requested_by) values ('host', 'scenic-city', 'approved', 't'), ('asker', 'scenic-city', 'pending', 't');
       insert into game_days (day, created_by) values ('2026-12-05', 't'), ('2026-12-12', 't');
       insert into program_game_days (program_id, game_day_id, added_by) select ${prog}, id, 't' from game_days where day = '2026-12-05';
       insert into gyms (name, org, address, active) values ('Game Gym', 'host', '1 Court St', true), ('Practice Gym', 'host', '2 Court St', true),
         ('Other Day Gym', 'host', '3 Court St', true), ('Closed Gym', 'host', '4 Court St', false), ('Asker Gym', 'asker', '5 Court St', true);
       insert into courts (gym_id, name) select id, 'Court 1' from gyms where name = 'Game Gym';
       insert into courts (gym_id, name) select id, 'Court 2' from gyms where name = 'Game Gym';
       insert into gym_availability (gym_id, day, use, starts, ends, set_by, set_at)
         select id, (case when name = 'Other Day Gym' then '2026-12-12' else '2026-12-05' end)::date, case when name = 'Practice Gym' then 'practice' else 'partner' end, '09:00', '17:00', 't', now() from gyms;
       insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 5, 5);
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('Aces', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't'), ('Bolts', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't');
       insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select ${prog}, t.id, (select id from scenic_pools), 't' from scenic_teams t;
       insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by, home_side, court_key, starts)
         select ${prog}, (select id from scenic_divisions), '2026-12-05', min(t.id), max(t.id), 't', 'a',
                (select 'o' || g.id || '-' || min(c.id) from gyms g join courts c on c.gym_id = g.id where g.name = 'Game Gym' group by g.id), '09:00' from scenic_teams t;`,
    );
    const want = { name: "Game Gym", hosts: ["Host Rec"], address: "1 Court St", map: null, courts: 2 };
    expect(await leagueGyms(db.pool, now, prog)).toEqual([{ ...want, days: [] }]); // not published: no dates
    await db.pool.query("insert into scenic_published_schedules (program_id, day, level, published_by, published_at) values ($1, '2026-12-05', 'COMP', 't', now())", [prog]);
    const shown = await leagueGyms(db.pool, now, prog);
    expect(shown).toEqual([{ ...want, days: [{ date: "2026-12-05", games: 1 }] }]);
    expect(JSON.stringify(shown)).not.toMatch(/Sam|Lee|423/);
    expect((await leagueGyms(db.pool, new Date("2026-12-07T15:00:00Z"), prog))[0].days).toEqual([]); // past
    expect(await leagueGyms(db.pool, now, "999999")).toEqual([]);
  }, 60_000);
});
