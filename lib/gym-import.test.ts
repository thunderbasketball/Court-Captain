import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { importGyms, parseGymRows, previewGymImport } from "./gym-import";
import { createOrganization } from "./org-signup";
import { createTestDb } from "./testing/db";

const jo: SessionUser = {
  coachId: "5550001",
  firstName: "Jo",
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
};
const thunderDirector: SessionUser = {
  ...jo,
  coachId: "9913694",
  isDirector: true,
  hasThunderRole: true,
  thunderAreas: ["facilities"],
};
const org = "east-ridge-parks-and-rec";

describe("importing gyms", () => {
  it("reads gym, short name and courts (a number or names)", () => {
    const { rows } = parseGymRows(
      'Gym,Short Name,Courts\nEast Ridge CC,ERCC,2\n"Big Gym, North",BGN,Main/Aux/Side\nBad,,',
      false,
    );
    expect(rows.map((r) => [r.name, r.short, r.courts, r.errors])).toEqual([
      ["East Ridge CC", "ERCC", ["Main", "Aux"], []],
      ["Big Gym, North", "BGN", ["Main", "Aux", "Side"], []],
      ["Bad", "", ["Main"], ["Short name: up to 8 letters or numbers"]],
    ]);
    expect(parseGymRows("Action Church,,", true).rows[0].courts).toEqual(["Goal #1", "Goal #2"]); // Thunder's default
  });

  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-02T15:00:00Z") });
  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from gyms where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jo', 'X', '4235550001'), ('9913694', 'Earl', 'Epps', '4239913694')",
    );
    const input = { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e" };
    await createOrganization(deps(), jo, { ...input, features: ["hosting-available"] }, null);
  });

  it("previews (new, already a gym, problems) and adds the new ones; Thunder's too", async () => {
    const text = "Gym,Short Name,Courts\nERCC,ER1,1\nMS Gym,MS,2\nERCC,ER2,1\nNope,,1";
    expect(await previewGymImport(deps(), { ...jo, coachId: "5550007" }, org, text)).toMatchObject({ ok: false });
    expect(await importGyms(deps(), jo, org, text)).toEqual({
      ok: true,
      added: ["ERCC", "MS Gym"],
      skipped: ["ERCC: Listed twice", "Nope: Short name: up to 8 letters or numbers"],
    });
    const again = (await previewGymImport(deps(), jo, org, text)) as { rows: { status: string }[] };
    expect(again.rows.map((r) => r.status)).toEqual(["exists", "exists", "error", "error"]);

    expect(await importGyms(deps(), thunderDirector, "thunder", "Action Church,,2")).toEqual({
      ok: true,
      added: ["Action Church"],
      skipped: [],
    });
    const courts = await db.pool.query(
      "select c.name from courts c join gyms g on g.id = c.gym_id where g.org = 'thunder' and g.name = 'Action Church' order by c.name",
    );
    expect(courts.rows.map((r) => r.name)).toEqual(["Goal #1", "Goal #2"]);
  });
});
