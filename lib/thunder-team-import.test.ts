import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { createTestDb } from "./testing/db";
import { orgMetrics } from "./org-metrics";
import { addStaff, getTeam, setHeadCoachEmail, setWaitingCoach } from "./teams";
import { importThunderTeams, listThunderImports, previewThunderImport, undoThunderImport } from "./thunder-team-import";

const director: SessionUser = {
  coachId: "9913694",
  firstName: "Earl",
  lastName: "Epps",
  isDirector: true,
  isCoach: false,
  requestPending: false,
  hasThunderRole: true,
};

describe("importing Thunder teams", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-02T15:00:00Z") });
  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('9913694', 'Earl', 'Epps', '4239913694')",
    );
  });

  it("names each team from its Head Coach, previews, adds the new ones as a batch, and undoes it", async () => {
    const text = `Gender,Grade,Level,Coach First,Coach Last,Coach Cell
Girls,4th,COMP,Earl,Epps,4239913694
Boys,3/4,REC,Sam,Lee,4235550101
Boys,4,COMP,Sam,Lee,4235550101
Boys,3,REC,,,,Comets`;
    expect(await previewThunderImport(deps(), { ...director, thunderAreas: ["facilities"] }, text)).toMatchObject({ ok: false });
    const pre = (await previewThunderImport(deps(), director, text)) as { rows: { name: string; status: string }[] };
    expect(pre.rows.map((r) => `${r.name || "-"}:${r.status}`)).toEqual([
      "4G Epps:new",
      "4B Lee 1:new", // the same name: both numbered
      "4B Lee 2:new",
      "3B TBD:new",
    ]);

    expect(await importThunderTeams(deps(), director, text)).toMatchObject({
      ok: true,
      added: ["4G Epps", "4B Lee 1", "4B Lee 2", "3B TBD"],
    });
    const roles = await db.pool.query("select has_role('5550101', 'thunder', 'Coach') as ok");
    expect(roles.rows[0].ok).toBe(true);
    expect(await importThunderTeams(deps(), director, text)).toMatchObject({ ok: true, added: [] }); // already there (TBD by its Alternate name)

    // A team with players is kept on Undo.
    const [batch] = (await listThunderImports(deps(), director))!;
    expect(batch).toMatchObject({ teams: 4, left: 4, undoneBy: null });
    const lee = (await db.pool.query<{ id: string }>("select id::text from teams where name = '4B Lee 1'")).rows[0].id;
    await db.pool.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       values ($1, 'r1', 'Kid', 'One', 'Boys', '4', 4, 'x', now())`,
      [lee],
    );
    expect(await undoThunderImport(deps(), director, batch.id)).toEqual({
      ok: true,
      removed: ["3B TBD", "4B Lee 2", "4G Epps"],
      kept: ["4B Lee 1"],
    });
    // Left alone, it dropped its number.
    await db.pool.query("delete from team_players");
    expect(await undoThunderImport(deps(), director, batch.id)).toEqual({ ok: true, removed: ["4B Lee"], kept: [] });
    expect((await listThunderImports(deps(), director))![0]).toMatchObject({ left: 0, undoneBy: "Earl Epps" });
  });

  it("a coach with no cell: the team is named for them and waits for it; their cell makes them the Head Coach", async () => {
    await db.pool.query("insert into org_roles (coach_id, org, role, granted_by) values ('9913694', 'thunder', 'Admin', 'x')");
    // Earl's paste: Gender, Grade, Coach First Name, Coach Last Name, Level. The same coach's COMP and REC teams.
    const text = `Gender\tGrade\tCoach First Name\tCoach Last Name\tLevel\tCoach Email
Girls\t3\tAlex\tCampbell\tCOMP\talex@example.com
Girls\t3\tAlex\tCampbell\tREC\t`;
    const pre = (await previewThunderImport(deps(), director, text)) as {
      rows: { name: string; status: string; coach: unknown; fixes: string[] }[];
    };
    expect(pre.rows.map((r) => `${r.name}:${r.status}`)).toEqual(["3G Campbell 1:new", "3G Campbell 2:new"]);
    expect(pre.rows[0].coach).toEqual({ first: "Alex", last: "Campbell", cell: null, email: "alex@example.com" });
    expect(pre.rows[0].fixes).toContain("Alex Campbell has no cell yet: the team waits for it (COACH CELL MUST BE ENTERED)");
    expect(await importThunderTeams(deps(), director, text)).toMatchObject({ added: ["3G Campbell 1", "3G Campbell 2"] });
    expect(await importThunderTeams(deps(), director, text)).toMatchObject({ added: [] }); // already there

    const ids = (await db.pool.query<{ id: string }>("select id::text from teams order by name")).rows.map((r) => r.id);
    expect(await getTeam(deps(), director, ids[0])).toMatchObject({
      waitingCoach: { first: "Alex", last: "Campbell" },
      staff: [],
    });
    const missing = async () =>
      (await orgMetrics(deps(), director, "thunder"))!.missing.map((t) => [t.name, t.noCoach, t.noCell, t.noEmail]);
    expect(await missing()).toEqual([
      ["3G Campbell 1", false, true, false],
      ["3G Campbell 2", false, true, false],
    ]);

    // Fix the name (renamed by it), then remove them (TBD again) and put them back.
    expect(await setWaitingCoach(deps(), director, ids[1], { first: "Alexis", last: "Campbel" })).toMatchObject({
      name: "3G Campbel",
    });
    expect(await setWaitingCoach(deps(), director, ids[0], null)).toMatchObject({ name: "3G TBD" });
    expect(await setWaitingCoach(deps(), director, ids[0], { first: "Alex", last: "Campbell" })).toMatchObject({
      name: "3G Campbell",
    });

    // Their cell: their login is made, they're the Head Coach, the team keeps its name; no email yet → flagged.
    expect(
      await addStaff(deps(), director, ids[0], {
        role: "HeadCoach",
        person: { first: "Alex", last: "Campbell", cell: "4235550123", email: "" },
      }),
    ).toMatchObject({ ok: true, newLogin: true, name: "3G Campbell" });
    expect(await getTeam(deps(), director, ids[0])).toMatchObject({
      waitingCoach: null,
      staff: [{ role: "HeadCoach", email: null }],
    });
    expect((await missing()).find((t) => t[0] === "3G Campbell")).toEqual(["3G Campbell", false, false, true]);
    expect(await setHeadCoachEmail(deps(), director, ids[0], "nope")).toMatchObject({ ok: false });
    expect(await setHeadCoachEmail(deps(), director, ids[0], "Alex@Example.com")).toEqual({ ok: true });
    expect(await setHeadCoachEmail(deps(), director, ids[0], "x@example.com")).toMatchObject({ ok: false }); // has one now
    expect((await missing()).find((t) => t[0] === "3G Campbell")).toEqual(["3G Campbell", false, false, false]); // no players yet
    // Only a Director of Teams.
    expect(await setWaitingCoach(deps(), { ...director, isDirector: false }, ids[1], null)).toMatchObject({ ok: false });
  });
});
