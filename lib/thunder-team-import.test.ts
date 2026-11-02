import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { createTestDb } from "./testing/db";
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
Boys,4,REC,Sam,Lee,4235550101
Boys,3,REC,,,,Comets`;
    expect(await previewThunderImport(deps(), { ...director, thunderAreas: ["facilities"] }, text)).toMatchObject({ ok: false });
    const pre = (await previewThunderImport(deps(), director, text)) as { rows: { name: string; status: string }[] };
    expect(pre.rows.map((r) => `${r.name || "-"}:${r.status}`)).toEqual([
      "4G Epps:new",
      "4B Lee:new",
      "4B Lee:error",
      "3B TBD:new",
    ]);

    expect(await importThunderTeams(deps(), director, text)).toMatchObject({ ok: true, added: ["4G Epps", "4B Lee", "3B TBD"] });
    const roles = await db.pool.query("select has_role('5550101', 'thunder', 'Coach') as ok");
    expect(roles.rows[0].ok).toBe(true);
    expect(await importThunderTeams(deps(), director, text)).toMatchObject({ ok: true, added: [] }); // already there (TBD by its Alternate name)

    // A team with players is kept on Undo.
    const [batch] = (await listThunderImports(deps(), director))!;
    expect(batch).toMatchObject({ teams: 3, left: 3, undoneBy: null });
    const lee = (await db.pool.query<{ id: string }>("select id::text from teams where name = '4B Lee'")).rows[0].id;
    await db.pool.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       values ($1, 'r1', 'Kid', 'One', 'Boys', '4', 4, 'x', now())`,
      [lee],
    );
    expect(await undoThunderImport(deps(), director, batch.id)).toEqual({
      ok: true,
      removed: ["3B TBD", "4G Epps"],
      kept: ["4B Lee"],
    });
    await db.pool.query("delete from team_players");
    expect(await undoThunderImport(deps(), director, batch.id)).toEqual({ ok: true, removed: ["4B Lee"], kept: [] });
    expect((await listThunderImports(deps(), director))![0]).toMatchObject({ left: 0, undoneBy: "Earl Epps" });
  });
});
