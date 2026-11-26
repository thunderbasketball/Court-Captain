import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { openConflicts, orgConflicts, teamDoubles, reviewConflict, rosterConflicts } from "./roster-conflicts";
import { previewPlayerRows } from "./org-rosters";
import { rosterAddWarnings } from "./roster-warnings";
import { orgTeamWarnings } from "./team-warnings";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false }) as SessionUser;
const dee = person("9913694", "Dee"); // Scenic City Director of Programs
const tia = person("5550102", "Tia"); // Scenic City Director of Teams only
const kim = person("5550101", "Kim"); // a coach

describe("roster conflicts in a League", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());

  it("finds players on two teams against the rule, for Directors of Programs; a decision sticks until a detail changes", async () => {
    const now = new Date("2026-11-24T15:00:00Z");
    const deps = { pool: db.pool, now: () => now };
    const q = async <T extends object = { id: string }>(sql: string, p: unknown[] = []) => (await db.pool.query<T>(sql, p)).rows;
    await q(
      "insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Dee', 'X', '4239913694'), ('5550101', 'Kim', 'X', '7065062534'), ('5550102', 'Tia', 'X', '7065062535')",
    );
    await grant(db.pool, "9913694 scenic-city Director", "5550102 scenic-city Director", "5550101 scenic-city Solo");
    await q("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'programs', 't'), ('5550102', 'scenic-city', 'teams', 't')");
    const prog = (
      await q(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-01-31', 't', 't') returning id::text`,
      )
    )[0].id;
    const pool = async (low: number, level: string) => {
      const div =
        (await q("select id::text from scenic_divisions where program_id = $1 and grade_low = $2", [prog, low]))[0] ??
        (await q("insert into scenic_divisions (program_id, gender, grade_low, grade_high) values ($1, 'Boys', $2, $3) returning id::text", [prog, low, low + 1]))[0];
      const g = (await q("insert into scenic_grade_groups (division_id, grade, level) values ($1, $2, $3) returning id::text", [div.id, low, level]))[0];
      return (await q("insert into scenic_pools (group_id, name) values ($1, 'A') returning id::text", [g.id]))[0].id;
    };
    const [p4c, p4r, p6c] = [await pool(4, "COMP"), await pool(4, "REC"), await pool(6, "COMP")];
    for (const s of ["aaa", "bbb"]) {
      await q("insert into organizations (slug, name, short_name, kind) values ($1, $1, upper($1), 'Organization')", [s]);
      await q("insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values ($1, 'Organization', false, true, true, 't', $1)", [s]);
    }
    const team = async (org: string, name: string, poolId: string, level = "COMP") => {
      const ot = (await q("insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ($1, $2, 'Boys', 4, 5, $3, 't') returning id::text", [org, name, level]))[0].id;
      const st = (
        await q(
          `insert into scenic_teams (name, gender, grade_low, grade, level, org_team_id, partner_id, created_by, updated_by)
           select $1, 'Boys', 4, 5, $2, $3, id, 't', 't' from partners where org_slug = $4 returning id::text`,
          [name, level, ot, org],
        )
      )[0].id;
      await q("insert into scenic_registrations (program_id, team_id, pool_id, registered_by) values ($1, $2, $3, 't')", [prog, st, poolId]);
      return { ot, st };
    };
    const a4 = await team("aaa", "A4", p4c);
    const a6 = await team("aaa", "A6", p6c);
    const aRec = await team("aaa", "ARec", p4r, "REC");
    const b4 = await team("bbb", "B4", p4c);
    const dev = await team("bbb", "Test (DEV)", p4c);
    const add = (t: { ot: string }, first: string, last: string, dob: string | null, grade = 4) =>
      q("insert into org_team_players (team_id, first_name, last_name, grade, birthdate, added_by) values ($1, $2, $3, $4, $5, 't')", [t.ot, first, last, grade, dob]);
    await add(a4, "Ava", "Up", "2016-05-03"); // A4 and A6: same organization, another division
    await add(a6, "Ava", "Up", "2016-05-03");
    await add(dev, "Ava", "Up", "2016-05-03"); // a test team doesn't count
    await add(a4, "Max", "Mix", "2016-01-02"); // COMP and REC
    await add(aRec, "MAX", "Mix", "2016-01-02");
    await add(a4, "Zoe", "Two", "2016-07-07"); // two organizations, the year wrong
    await add(b4, "Zoe", "Two", "2026-07-07");
    await add(a4, "Tim", "Twin", "2016-08-08"); // twins on one team
    await add(a4, "Tom", "Twin", "2016-08-08");
    await add(b4, "Nia", "None", null);

    // Who sees it.
    expect(await rosterConflicts(deps, kim, prog)).toBeNull();
    expect(await rosterConflicts(deps, tia, prog)).toBeNull();
    expect(await rosterConflicts(deps, dee, "x")).toBeNull();
    expect(await rosterConflicts(deps, dee, "999")).toBeNull();

    const look = async () => (await rosterConflicts(deps, dee, prog))!;
    const brief = (l: Awaited<ReturnType<typeof look>>["conflicts"]) => l.map((c) => [c.strength, c.broken, [c.a.team, c.b.team].sort()]);
    let r = await look();
    expect(brief(r.conflicts)).toEqual([
      ["Conflict", ["REC and COMP", "Same division"], ["A4", "ARec"]],
      ["Likely", ["Different organizations", "Same division"], ["A4", "B4"]],
    ]);
    expect(brief(r.allowed)).toEqual([["Conflict", [], ["A4", "A6"]]]);
    expect(r).toMatchObject({ teams: 4, withRoster: 4, missing: 1, reviewed: [] });
    expect(r.birthdates).toMatchObject([{ name: "Zoe Two", why: "Born 2026", team: "B4" }]);
    expect(await openConflicts(db.pool, "scenic-city", now)).toEqual([{ programId: prog, program: "Winter", conflicts: r.conflicts, allowed: r.allowed }]);
    expect(r.allowed[0].allowed).toBe("Within the rules: same organization, different divisions, both COMP");
    expect(r.conflicts.map((c) => c.allowed)).toEqual([null, null]);

    // Its organizations see theirs, with the other organization and team (not the player's birthdate or a link); not the League itself.
    const ours = (await orgConflicts(db.pool, "bbb", now))[0];
    expect(ours).toMatchObject({ program: "Winter", allowed: [], conflicts: [{ a: { team: "B4", name: "Zoe Two" }, b: { team: "A4", dob: null, teamId: "", sourceId: null } }] });
    const theirs = (await orgConflicts(db.pool, "aaa", now))[0];
    expect(theirs.conflicts.map((c) => [c.a.team, c.b.team].sort())).toEqual([["A4", "ARec"], ["A4", "B4"]]);
    expect(theirs.allowed.map((c) => [c.a.team, c.b.team].sort())).toEqual([["A4", "A6"]]);
    expect(await orgConflicts(db.pool, "scenic-city", now)).toEqual([]);
    expect(await orgConflicts(db.pool, "thunder", now)).toEqual([]);
    expect((await orgTeamWarnings(db.pool, "bbb", now)).conflicts).toHaveLength(1);
    // On each team's page.
    const doubles = async (id: string) => (await teamDoubles(db.pool, { orgTeamId: id }, now)).map((d) => [d.name, d.other, !!d.allowed]).sort();
    expect(await doubles(a6.ot)).toEqual([["Ava Up", "A4", true]]);
    expect(await doubles(b4.ot)).toEqual([["Zoe Two", "AAA · A4", false]]);
    expect(await doubles(a4.ot)).toEqual([["Ava Up", "A6", true], ["Max Mix", "ARec", false], ["Zoe Two", "BBB · B4", false]]);
    expect(await teamDoubles(db.pool, { orgTeamId: a4.ot }, new Date("2029-01-01"))).toEqual([]); // over

    // Decided: kept with who, only by a Director of Programs; changed or taken back.
    const pair = r.conflicts[1].pair;
    expect(await reviewConflict(deps, kim, prog, pair, "different")).toMatchObject({ ok: false });
    expect(await reviewConflict(deps, tia, prog, pair, "different")).toMatchObject({ ok: false });
    expect(await reviewConflict(deps, dee, prog, "nope", "different")).toMatchObject({ ok: false });
    expect(await reviewConflict(deps, dee, prog, pair, "deleted")).toMatchObject({ ok: false });
    expect(await reviewConflict(deps, dee, prog, pair, "allowed")).toMatchObject({ ok: false }); // why?
    expect(await reviewConflict(deps, dee, prog, pair, "allowed", "  Board vote\n Nov 20 ")).toEqual({ ok: true });
    expect((await look()).reviewed[0].allowed).toBe("The League allowed it: Board vote Nov 20 (Dee X)");
    expect(await doubles(b4.ot)).toEqual([["Zoe Two", "AAA · A4", true]]);
    expect(await reviewConflict(deps, dee, prog, pair, "different")).toEqual({ ok: true });
    r = await look();
    expect(r.conflicts).toHaveLength(1);
    expect(r.reviewed).toMatchObject([{ pair, review: { decision: "different", by: "Dee X" } }]);
    expect(await openConflicts(db.pool, "scenic-city", now)).toMatchObject([{ conflicts: [{ strength: "Conflict" }] }]);
    expect(await reviewConflict(deps, dee, prog, pair, null)).toEqual({ ok: true });
    expect((await look()).conflicts).toHaveLength(2);
    await reviewConflict(deps, dee, prog, pair, "different");
    await q("update org_team_players set birthdate = '2016-07-07' where first_name = 'Zoe'"); // now the same: back to look at
    r = await look();
    expect(r.conflicts.map((c) => c.strength)).toEqual(["Conflict", "Conflict"]);
    expect(r.reviewed).toEqual([]);

    // Warned before adding: only whoever may change that roster, and another organization's team isn't named.
    await q("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550101', 'HeadCoach', 't')", [a6.ot]); // Kim coaches A6
    const t6 = { kind: "org" as const, org: "aaa", teamId: a6.ot };
    const typed = (first: string, last: string, birthdate: string) => [{ first, last, grade: "4", birthdate }];
    const warn = (who: SessionUser, target: Parameters<typeof rosterAddWarnings>[2], p: unknown) => rosterAddWarnings(deps, who, target, p);
    const b4Max = [...typed("Max", "Mix", "1/2/2016")];
    expect(await warn(kim, t6, b4Max)).toEqual(["Max Mix is on ARec (Boys 4th–5th REC) in Winter. A player can't be on a REC and a COMP team."]);
    expect(await warn(kim, t6, typed("Zoe", "Two", "7/7/2017"))).toEqual([
      "Zoe Two may be on another organization's team in Winter. A player can be on teams in only one organization.",
    ]);
    expect(await warn(kim, t6, typed("Tim", "Twin", "8/8/2016"))).toEqual([]); // allowed: the same organization, another division
    expect(await warn(kim, t6, typed("Nia", "None", ""))).toEqual([]); // a maybe in another organization isn't said
    expect(await warn(kim, t6, typed("New", "Kid", "8/8/2016"))).toEqual([]);
    expect(await warn(tia, t6, b4Max)).toEqual([]); // not their roster
    expect(await warn(kim, { ...t6, teamId: b4.ot }, b4Max)).toEqual([]); // another organization's team
    expect(await warn(kim, { ...t6, org: "bbb", teamId: b4.ot }, b4Max)).toEqual([]);
    expect(await warn(kim, { kind: "league", teamId: a6.st }, b4Max)).toEqual([]);
    expect(await warn(kim, { kind: "thunder", teamId: "1" }, ["x"])).toEqual([]);
    expect(await warn(kim, { kind: "locked", programId: prog, teamId: a6.st }, b4Max)).toEqual([]);
    expect(await warn(kim, { ...t6, teamId: "x" }, b4Max)).toEqual([]);
    // An import's Preview says it on the row, with birthdates that can't be right; it can still be added.
    const pre = await previewPlayerRows(deps, kim, "aaa", a6.ot, [
      { first: "Max", last: "Mix", grade: "6", jersey: "", birthdate: "1/2/2016" },
      { first: "New", last: "Kid", grade: "6", jersey: "", birthdate: "5/3/2026" },
      { first: "Fine", last: "Kid", grade: "6", jersey: "", birthdate: "5/3/2014" },
    ]);
    expect(pre.ok && pre.rows.map((x) => [x.status, x.warnings?.length])).toEqual([
      ["new", 1],
      ["new", 1],
      ["new", 0],
    ]);
    expect(pre.ok && pre.rows[1].warnings).toEqual(["Born 2026: that can't be right. Check the birthdate."]);

    // A locked League roster is what counts, not the roster now. A team taken out doesn't count.
    await q("insert into scenic_roster_snapshots (program_id, team_id, first_game_at) values ($1, $2, now())", [prog, b4.st]);
    await q("insert into scenic_snapshot_players (program_id, team_id, first_name, last_name, grade, birthdate) values ($1, $2, 'Nia', 'None', '4', null)", [prog, b4.st]);
    expect(brief((await look()).conflicts)).toEqual([["Conflict", ["REC and COMP", "Same division"], ["A4", "ARec"]]]);
    // A locked League roster being fixed: its own check, for the League's Directors of Teams.
    expect(await warn(tia, { kind: "locked", programId: prog, teamId: b4.st }, typed("Zoe", "Two", "7/7/2016"))).toEqual([
      "Zoe Two is on another organization's team in Winter. A player can be on teams in only one organization. A player can't be on two teams in the same division.",
    ]);
    expect(await warn(dee, { kind: "locked", programId: prog, teamId: b4.st }, typed("Zoe", "Two", "7/7/2016"))).toEqual([]); // Programs, not Teams
    await q("update scenic_registrations set removed_by = 't', removed_at = now() where team_id = $1", [aRec.st]);
    expect((await look()).conflicts).toEqual([]);
    expect((await openConflicts(db.pool, "scenic-city", now)).flatMap((p) => p.conflicts)).toEqual([]); // only an allowed pair is left
  });
});
