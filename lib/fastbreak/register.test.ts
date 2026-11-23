import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../auth/service";
import { leagueEntry } from "../scenic-programs";
import { createTestDb, grant } from "../testing/db";
import type { FastbreakClient, FbEvent, FbTeam } from "./client";
import { fastbreakList, registerFastbreakTeam } from "./register";

const ev = (id: number, type: string, start: string, end = start): FbEvent => ({ id, name: `Event ${id}`, type, start, end, archived: false, sportId: 2 });
const team = (id: number, org: string, grade: number, coach: [string, string, string], name = `FB Team ${id}`): FbTeam => ({
  id,
  name,
  genderId: 1,
  grade,
  organizationId: id * 10,
  organizationName: org,
  staff: [{ firstName: coach[0], lastName: coach[1], title: "Head Coach", phone: coach[2], email: null }],
});
const person = (coachId: string, firstName: string): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false }) as SessionUser;
const dee = person("9913694", "Dee"); // Scenic City Director of Teams
const sam = person("5550002", "Sam"); // no role

describe("FastBreak list: register FastBreak's teams into Scenic City", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());

  const events = [
    ev(1, "super-event", "2026-12-05", "2027-02-28"),
    ev(2, "single-day", "2026-12-05"),
    ev(3, "single-day", "2026-12-12"),
    ev(4, "multi-day", "2027-02-20", "2027-02-28"), // the Championship: over the League's Bracket Days
  ];
  const magic = team(10, "Matthew Phillips", 5, ["Mo", "Gray", "4235550101"], "Magic Hoops - Gray");
  const bea = team(11, "Baylor School", 4, ["Bea", "Long", "4235550202"]);
  const teams: Record<number, FbTeam[]> = {
    2: [magic, bea, team(13, "Valor", 5, ["Val", "Reed", "4235550404"])],
    3: [magic, bea],
    4: [magic],
  };
  const client: FastbreakClient = { events: async () => events, teams: async (id) => teams[id] ?? [] };
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-20T15:00:00Z"), client });
  let prog = "";
  let beaTeam = "";

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('9913694', 'Dee', 'X', '4239913694'), ('5550002', 'Sam', 'X', '4235550002'), ('5550202', 'Bea', 'Long', '4235550202'),
         ('5550404', 'Val', 'Reed', '4235550404')`,
    );
    await grant(db.pool, "9913694 scenic-city Director");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'teams', 'test')");
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
       insert into scenic_program_options (program_id, kind, fee_cents)
         values (${prog}, 'all_season', 25000), (${prog}, 'single_1', 4000), (${prog}, 'single_2', 7000);
       insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 4, 5);
       insert into scenic_grade_groups (division_id, grade, level)
         select d.id, g, l from scenic_divisions d, generate_series(4, 5) g, unnest(array['COMP', 'REC']) l;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;
       insert into partners (name, kind, hosts_games, registers_teams, approved, created_by) values ('Baylor School', 'School', false, true, true, 't');`,
    );
    // Bea already registered her team in the app (no dates yet); Val's is in Scenic City but not registered (backlog).
    beaTeam = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, coach_id, created_by, updated_by)
         select 'BS 4B Long', 'Boys', 4, 4, 'COMP', id, '5550202', 't', 't' from partners where name = 'Baylor School' returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into scenic_registrations (program_id, team_id, pool_id, registered_by)
       select ${prog}, ${beaTeam}, po.id, 't' from scenic_pools po join scenic_grade_groups g on g.id = po.group_id where g.grade = 4 and g.level = 'COMP';
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('5B Valor Reed', 'Boys', 5, 5, 'COMP', '5550404', '5550404', 't', 't');`,
    );
  });

  const days = async (id: string) =>
    (
      await db.pool.query<{ day: string; kind: string }>(
        `select to_char(g.day, 'YYYY-MM-DD') as day, d.kind from scenic_registration_days d join game_days g on g.id = d.game_day_id
          where d.team_id = $1 order by g.day`,
        [id],
      )
    ).rows.map((r) => `${r.day} ${r.kind}`);

  it("one list (not in Scenic City first); Register adds a Solo team or links, with its weeks (1GG / 2GG) and the Brackets", async () => {
    expect(await fastbreakList(deps(), sam)).toBeNull(); // Directors of Teams only
    const list = await fastbreakList(deps(), dee);
    if (!list?.ok) throw new Error(JSON.stringify(list));
    // Not in Scenic City first; Val's (same coach, not registered yet); Bea's (same coach, registered) last.
    expect(list.teams.map((t) => [t.fbId, t.weeks, t.brackets, t.here?.how ?? null, t.here?.registered ?? null])).toEqual([
      [10, ["2026-12-05", "2026-12-12"], true, null, null],
      [13, ["2026-12-05"], false, "coach", false],
      [11, ["2026-12-05", "2026-12-12"], false, "coach", true],
    ]);
    // Its Scenic City name: the Team Name filled in from FastBreak's team name (without "- Gray"), the coach's last name.
    expect(list.teams[0]).toMatchObject({ part: "Magic Hoops", coachLast: "Gray" });
    expect(JSON.stringify(list)).not.toMatch(/423555/); // no cells sent to the page

    expect(await registerFastbreakTeam(deps(), sam, 10)).toMatchObject({ ok: false });
    expect(await registerFastbreakTeam(deps(), dee, 10, { part: "=cmd|x" })).toMatchObject({ ok: false, message: /Team Name/ });
    expect(await registerFastbreakTeam(deps(), dee, 10, { level: "PRO" })).toMatchObject({ ok: false, message: /COMP or REC/ });

    // A new team: in the FastBreak club (FastBreak treated like an organization; no club from its FastBreak organization),
    // coached by Mo; REC; Dec 12 as 2GG;
    // put in the Brackets from FastBreak's Championship; by Dee.
    const added = await registerFastbreakTeam(deps(), dee, 10, { part: "Magic Elite", level: "REC", twoGames: ["2026-12-12"] });
    expect(added).toEqual({ ok: true, how: "added", name: "5B Magic Elite Gray" });
    const t10 = (
      await db.pool.query<{ id: string; club: string; owner: string | null; coach: string; level: string; created_by: string }>(
        `select t.id::text, p.name as club, t.owner_coach_id as owner, c.first_name as coach, t.level, t.created_by
           from scenic_teams t join partners p on p.id = t.partner_id join users c on c.coach_id = t.coach_id where t.fastbreak_id = 10`,
      )
    ).rows[0];
    expect(t10).toMatchObject({ club: "FastBreak", owner: null, coach: "Mo", level: "REC", created_by: "Dee X" });
    expect((await db.pool.query("select name from partners order by name")).rows.map((r) => r.name)).toEqual(["Baylor School", "FastBreak"]);
    expect(await days(t10.id)).toEqual(["2026-12-05 single_1", "2026-12-12 single_2"]);
    expect((await db.pool.query("select bracket_by from scenic_registrations where team_id = $1", [t10.id])).rows[0].bracket_by).toBe("Dee X");
    expect((await leagueEntry(db.pool, prog, t10.id)).entry).toMatchObject({ bracket: true, perDate: { "2026-12-05": 1, "2026-12-12": 2 } });

    // REC limited to the organizations Scenic City picked: the FastBreak list (a Director of Teams) registers REC anyway.
    await db.pool.query("update scenic_programs set rec_limited_by = 'Dee X', rec_limited_at = now()");
    // Val's backlog team: linked and registered now (no duplicate), at the level picked (REC; it wasn't registered yet).
    expect(await registerFastbreakTeam(deps(), dee, 13, { level: "REC" })).toEqual({ ok: true, how: "linked", name: "5B Valor Reed" });
    expect((await db.pool.query("select level from scenic_teams where fastbreak_id = 13")).rows[0].level).toBe("REC");
    expect(await days((await db.pool.query<{ id: string }>("select id::text from scenic_teams where fastbreak_id = 13")).rows[0].id)).toEqual([
      "2026-12-05 single_1",
    ]);
    // Bea's team: linked; its FastBreak weeks added; not in the Championship, so not put in the Brackets by hand.
    expect(await registerFastbreakTeam(deps(), dee, 11, { level: "REC" })).toEqual({ ok: true, how: "linked", name: "BS 4B Long" });
    expect((await db.pool.query("select level from scenic_teams where id = $1", [beaTeam])).rows[0].level).toBe("COMP"); // registered: stays
    expect(await days(beaTeam)).toEqual(["2026-12-05 single_1", "2026-12-12 single_1"]);
    expect((await db.pool.query("select bracket_by from scenic_registrations where team_id = $1", [beaTeam])).rows[0].bracket_by).toBeNull();
    expect((await db.pool.query("select count(*)::int as n from scenic_teams")).rows[0].n).toBe(3);

    // Now all linked and registered; registering again changes nothing.
    const again = await fastbreakList(deps(), dee);
    expect(again?.ok && again.teams.map((t) => [t.here?.how, t.here?.registered])).toEqual([
      ["linked", true],
      ["linked", true],
      ["linked", true],
    ]);
    expect(await registerFastbreakTeam(deps(), dee, 10)).toMatchObject({ ok: true, how: "linked" });
    expect(await registerFastbreakTeam(deps(), dee, 99)).toMatchObject({ ok: false, message: /isn't in FastBreak/ });
  }, 120_000);
});
