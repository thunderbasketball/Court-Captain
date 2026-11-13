import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, grant } from "./testing/db";
import { hostDocuments } from "./host-documents";
import { setProgramRules } from "./scenic-programs";
import { gymScoresheets } from "./scoresheets";

const ORG = "hosty";
describe("hosting organization's Documents", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-12T15:00:00Z") });
  const person = (coachId: string) => ({ coachId, firstName: "P", lastName: coachId, isDirector: false }) as never;
  const host = person("5550001"); // the host's Admin
  const pam = person("5550002"); // Scenic City Director of Programs
  let prog = "";
  let gym = "";
  let other = "";

  beforeEach(async () => {
    await db.reset();
    await db.pool.query(`delete from org_role_types where org = '${ORG}'; delete from organizations where slug = '${ORG}'`);
    await db.pool.query(`insert into organizations (slug, name, short_name) values ('${ORG}', 'Hosty Hoops', 'HH')`);
    await db.pool.query(`insert into org_role_types (org, role) select '${ORG}', r from unnest(array['Request', 'Coach', 'Director', 'Admin', 'Owner']) r`);
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Hal', 'Host', '4235550001'), ('5550002', 'Pam', 'P', '4235550002'), ('5550003', 'Nat', 'N', '4235550003')`,
    );
    await grant(db.pool, `5550001 ${ORG} Admin`, "5550002 scenic-city Director");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('5550002', 'scenic-city', 'programs', 't')");
    await db.pool.query(`insert into org_features (org, feature, source, turned_on_by) values ('${ORG}', 'court-sync', 'setup', 't')`); // CourtSync as a Host
    gym = (await db.pool.query<{ id: string }>(`insert into gyms (org, name) values ('${ORG}', 'Hosty Gym') returning id::text`)).rows[0].id;
    other = (await db.pool.query<{ id: string }>(`insert into gyms (org, name) values ('thunder', 'Other Gym') returning id::text`)).rows[0].id;
    prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter League', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
       values ('League', 'Old League', '2025-12-05', '2026-02-28', '2025-10-01', '2026-02-14', 't', 't');
       insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 5, 5);
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('A', 'Boys', 5, 5, 'COMP', '5550003', '5550003', 't', 't'), ('B', 'Boys', 5, 5, 'COMP', '5550003', '5550003', 't', 't'),
                ('C', 'Boys', 5, 5, 'COMP', '5550003', '5550003', 't', 't');
       insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select ${prog}, id, (select id from scenic_pools), 't' from scenic_teams;`,
    );
    const ids = (await db.pool.query<{ id: string }>("select id::text from scenic_teams order by name")).rows.map((r) => r.id);
    const place = (a: string, b: string | null, day: string, key: string, at: string) =>
      db.pool.query(
        `insert into scenic_matchups (program_id, division_id, day, team_a, team_b, created_by, court_key, starts)
         select $1, id, $2, $3, $4, 't', $5, $6 from scenic_divisions`,
        [prog, day, a, b, key, at],
      );
    await place(ids[0], ids[1], "2026-12-05", `o${gym}-gym`, "09:00");
    await place(ids[2], null, "2026-12-05", `o${gym}-gym`, "10:00");
    await place(ids[0], ids[2], "2026-12-12", `o${other}-gym`, "09:00");
    await place(ids[1], null, "2026-11-07", `o${gym}-gym`, "09:00"); // past
  });

  it("the League adds its rules as a PDF (Directors of Programs only, a real PDF, 4 MB at most)", async () => {
    const pdf = { bytes: new TextEncoder().encode("%PDF-1.7 rules"), name: "Winter Rules.pdf" };
    expect(await setProgramRules(deps(), host, prog, pdf)).toMatchObject({ ok: false });
    expect(await setProgramRules(deps(), pam, prog, { bytes: new TextEncoder().encode("hello"), name: "x.pdf" })).toMatchObject({ ok: false, message: /PDF/ });
    expect(await setProgramRules(deps(), pam, prog, { bytes: new Uint8Array(4 * 1024 * 1024 + 1), name: "big.pdf" })).toMatchObject({ ok: false, message: /4 MB/ });
    expect(await setProgramRules(deps(), pam, prog, pdf)).toEqual({ ok: true });
    expect((await db.pool.query("select rules_name, rules_by from scenic_programs where id = $1", [prog])).rows[0]).toEqual({ rules_name: "Winter Rules.pdf", rules_by: "P 5550002" });
    expect(await setProgramRules(deps(), pam, prog, null)).toEqual({ ok: true });
    expect((await db.pool.query("select rules is null as gone from scenic_programs where id = $1", [prog])).rows[0].gone).toBe(true);
  });

  it("Documents: this season's Leagues and their rules, and coming Game Days at the host's gyms; its Admins only", async () => {
    expect(await hostDocuments(deps(), pam, ORG)).toBeNull();
    expect(await hostDocuments(deps(), host, ORG)).toEqual({
      leagues: [{ id: prog, name: "Winter League", rules: null }],
      days: [{ day: "2026-12-05", gyms: [{ key: `o${gym}`, name: "Hosty Gym", games: 2 }] }],
    });
    await setProgramRules(deps(), pam, prog, { bytes: new TextEncoder().encode("%PDF-1.4"), name: "R.pdf" });
    expect((await hostDocuments(deps(), host, ORG))!.leagues[0].rules).toBe("R.pdf");
    await db.pool.query(`delete from org_features where org = '${ORG}'`); // no longer hosting
    expect(await hostDocuments(deps(), host, ORG)).toBeNull();
  });

  it("the host prints its own gym's scoresheets, not another organization's", async () => {
    expect((await gymScoresheets(deps(), host, "2026-12-05", `o${gym}`))!.sheets.map((s) => [s.starts, s.home?.name, s.away?.name ?? "TBD"])).toEqual([
      ["09:00", "A", "B"],
      ["10:00", "C", "TBD"],
    ]);
    expect(await gymScoresheets(deps(), host, "2026-12-12", `o${other}`)).toBeNull();
  });
});
