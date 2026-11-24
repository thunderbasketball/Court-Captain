import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addSnapshotPlayer, leagueRosters, setSnapshotPlayer } from "./roster-snapshot";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false }) as SessionUser;
const dee = person("9913694", "Dee"); // Scenic City Director of Teams
const kim = person("5550101", "Kim"); // a coach

describe("League rosters: the snapshot at a team's 1st game", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  it("saved before the first change after the 1st game (a forfeit counts); later changes don't touch it; a Director fixes it", async () => {
    // The database's own clock decides for roster changes: games are set around the real now.
    const deps = { pool: db.pool, now: () => new Date() };
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const q = async <T extends object = { id: string }>(sql: string, p: unknown[] = []) => (await db.pool.query<T>(sql, p)).rows;
    await q("insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Dee', 'X', '4239913694'), ('5550101', 'Kim', 'X', '7065062534')");
    await grant(db.pool, "9913694 scenic-city Director", "5550101 scenic-city Solo");
    await q("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'teams', 't')");
    const prog = (
      await q(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', $1, $2, $1, $2, 't', 't') returning id::text`,
        [day(-30), day(60)],
      )
    )[0].id;
    const div = (await q("insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Boys', 4, 5) returning id::text", [prog]))[0].id;
    await q("insert into scenic_grade_groups (division_id, grade, level) values ($1, 5, 'COMP')", [div]);
    await q("insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups");
    const team = async (name: string) =>
      (
        await q(
          `insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, created_by, updated_by)
           values ($1, 'Boys', 5, 5, 'COMP', '5550101', 't', 't') returning id::text`,
          [name],
        )
      )[0].id;
    const [a, b, c, d] = [await team("A"), await team("B"), await team("C"), await team("D")];
    await q("insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select $1, t.id, (select id from scenic_pools), 't' from scenic_teams t", [prog]);
    // An organization's team (its roster is kept there) and a Thunder team play too.
    await q("insert into organizations (slug, name, short_name, kind) values ('chatt', 'Chatt', 'Chatt', 'Organization')");
    const ot = (
      await q("insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('chatt', 'O', 'Boys', 5, 5, 'COMP', 't') returning id::text")
    )[0].id;
    await q("insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values ('Chatt', 'Organization', false, true, true, 't', 'chatt')");
    const o = (
      await q(
        `insert into scenic_teams (name, gender, grade_low, grade, level, org_team_id, partner_id, created_by, updated_by)
         select 'O', 'Boys', 5, 5, 'COMP', $1, id, 't', 't' from partners where org_slug = 'chatt' returning id::text`,
        [ot],
      )
    )[0].id;
    await q("insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select $1, $2, id, 't' from scenic_pools", [prog, o]);
    const add = (t: string, first: string, jersey: string) =>
      q("insert into scenic_team_players (team_id, first_name, last_name, grade, jersey, birthdate, added_by) values ($1, $2, 'P', 5, $3, '2016-05-03', 't')", [t, first, jersey]);
    const addOrg = (first: string) => q("insert into org_team_players (team_id, first_name, last_name, grade, jersey, added_by) values ($1, $2, 'P', 5, '9', 't')", [ot, first]);
    for (const t of [a, b, c, d]) await add(t, "Ava", "12");
    await addOrg("Ona");
    const game = (x: string, y: string, on: string, extra = "") =>
      q(
        `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by, court_key, starts ${extra ? ", forfeit, scored_by, scored_at" : ""})
         values ($1, $2, $3, least($4::bigint, $5::bigint), greatest($4::bigint, $5::bigint), 't', $6, '10:00' ${extra})`,
        [prog, div, on, x, y, `${x}${y}`],
      );
    await game(a, b, day(-2)); // played
    await game(c, d, day(2)); // not yet
    const names = async (t: string) => (await leagueRosters(deps, dee, t)).map((r) => r.players.map((p) => p.first));

    // Not posted: nothing is played yet. Posted: A and B have played their 1st game, C and D haven't.
    await add(a, "Eve", "4");
    expect(await names(a)).toEqual([]);
    await q("insert into scenic_published_days (program_id, day, published_by, published_at) select distinct program_id, day, 't', now() from scenic_matchups");
    // The first change after the 1st game saves the roster as it was first (Zed isn't on it), then changes freely.
    await add(a, "Zed", "1");
    await q("delete from scenic_team_players where team_id = $1 and first_name = 'Ava'", [a]);
    expect(await names(a)).toEqual([["Eve", "Ava"]]); // by number
    expect(await names(b)).toEqual([["Ava"]]); // saved when first looked at
    expect(await names(c)).toEqual([]); // its 1st game is ahead
    expect((await leagueRosters(deps, dee, a))[0].players[1]).toMatchObject({ jersey: "12", birthdate: "2016-05-03", addedBy: null });
    // A forfeited game counts as the 1st game (an organization's team).
    await game(c, o, day(-1), ", 'a', 't', now()");
    await addOrg("Late");
    expect(await names(o)).toEqual([["Ona"]]);
    expect(await names(c)).toEqual([["Ava"]]);

    // Fixing it: the League's Directors only; recorded; taken out stays, crossed out; back on again.
    const [roster] = await leagueRosters(deps, kim, a);
    expect(roster.mayFix).toBe(false);
    const eve = roster.players[0].id;
    expect(await addSnapshotPlayer(deps, kim, prog, a, { first: "Zed", last: "P" })).toMatchObject({ ok: false });
    expect(await setSnapshotPlayer(deps, kim, eve, true)).toMatchObject({ ok: false });
    expect(await addSnapshotPlayer(deps, dee, prog, a, { first: "=cmd", last: "P" })).toMatchObject({ ok: false });
    expect(await addSnapshotPlayer(deps, dee, prog, a, { first: "Eve", last: "P" })).toMatchObject({ ok: false }); // already on it
    expect(await addSnapshotPlayer(deps, dee, prog, a, { first: "Zed", last: "P", grade: "5", jersey: "1", birthdate: "5/3/2016" })).toEqual({ ok: true });
    expect(await setSnapshotPlayer(deps, dee, eve, true)).toEqual({ ok: true });
    expect((await leagueRosters(deps, dee, a))[0].players.map((p) => [p.first, p.addedBy, p.removedBy])).toEqual([
      ["Zed", "Dee X", null],
      ["Ava", null, null],
      ["Eve", null, "Dee X"],
    ]);
    expect(await setSnapshotPlayer(deps, dee, eve, false)).toEqual({ ok: true });
    expect(await addSnapshotPlayer(deps, dee, prog, d, { first: "Zed", last: "P" })).toMatchObject({ ok: false }); // no snapshot yet
    // Deleting a team with a snapshot still works.
    await q("delete from scenic_teams where id = $1", [b]);
    expect(await q("select 1 from scenic_roster_snapshots where team_id = $1", [b])).toEqual([]);
  }, 120_000);
});
