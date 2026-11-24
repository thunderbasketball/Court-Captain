import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { orgInfo } from "./org-registry";
import { createOrganization, setOrgDefaultAlt } from "./org-signup";
import { createTestDb } from "./testing/db";

const jo = { coachId: "5550001", firstName: "Jordan", lastName: "Harris", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false } as SessionUser;
const sam = { ...jo, coachId: "5550002", firstName: "Sam" } as SessionUser;

describe("an organization's Default Alternate name (leagues only)", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-23T15:00:00Z") });
  let slug = "";

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jordan', 'Harris', '4235550001'), ('5550002', 'Sam', 'X', '4235550002')",
    );
    const r = (await createOrganization(
      deps(),
      jo,
      { name: "Baylor School", short: "Baylor", kind: "School", color: "#0f766e", features: ["court-club"] },
      null,
    )) as { slug: string };
    slug = r.slug;
    // Two teams with League copies: one named by the rule (no Alternate name), one with its own ("Bolts").
    await db.pool.query(
      `insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug)
       select 'Baylor School', 'School', false, true, true, 't', $1::text
        where not exists (select 1 from partners where org_slug = $1::text)`,
      [slug],
    );
    await db.pool.query(
      `insert into org_teams (org, name, gender, grade_low, grade, level, alt_name, created_by)
       values ($1, '5B Baylor Lee', 'Boys', 5, 5, 'COMP', null, 't'), ($1, '5B Bolts Kim', 'Boys', 5, 5, 'COMP', 'Bolts', 't')`,
      [slug],
    );
    await db.pool.query(
      `insert into scenic_teams (name, gender, grade_low, grade, level, partner_id, org_team_id, created_by, updated_by)
       select t.name, t.gender, t.grade_low, t.grade, t.level, (select id from partners where org_slug = $1 limit 1), t.id, 't', 't'
         from org_teams t where t.org = $1`,
      [slug],
    );
  });

  const leagueNames = async () =>
    (await db.pool.query<{ name: string }>("select name from scenic_teams order by name")).rows.map((r) => r.name);

  it("its Admins set it; League names use it in the organization's place, except a team with its own Alternate name", async () => {
    expect(await setOrgDefaultAlt(deps(), sam, slug, "Red Raiders")).toMatchObject({ ok: false }); // not its Admin
    expect(await setOrgDefaultAlt(deps(), jo, slug, "=cmd|x")).toMatchObject({ ok: false });
    expect(await setOrgDefaultAlt(deps(), jo, slug, " Red  Raiders ")).toEqual({ ok: true });
    expect((await orgInfo(db.pool, slug))?.defaultAlt).toBe("Red Raiders");
    expect(await leagueNames()).toEqual(["5B Bolts Kim", "5B Red Raiders Lee"]);
    // Team names inside the organization stay as they are.
    expect((await db.pool.query("select name from org_teams order by name")).rows.map((r) => r.name)).toEqual(["5B Baylor Lee", "5B Bolts Kim"]);
    // Blank removes it: back to the organization's name.
    expect(await setOrgDefaultAlt(deps(), jo, slug, "")).toEqual({ ok: true });
    expect(await leagueNames()).toEqual(["5B Baylor Lee", "5B Bolts Kim"]);
  }, 120_000);
});
