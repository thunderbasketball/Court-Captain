import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { makeSoloAccount, myAccounts, replaceSoloTeam, switchSoloToOrg } from "./court-solo";
import { orgFeatureKeys, orgFeatures } from "./features";
import { renameOrg } from "./org-signup";
import { createOrgTeam } from "./org-teams";
import { publicLeague } from "./public-league";
import { withTx } from "./sql";
import { createTestDb } from "./testing/db";

describe("CourtSolo: a stand-alone team's own account", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  const now = new Date("2026-12-01T15:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const earl = { coachId: "9913694", firstName: "Earl", lastName: "Epps", isDirector: true } as unknown as SessionUser;
  let prog = "";
  let team = "";
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from org_features where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell, active) values ('9913694', 'Earl', 'Epps', '4239913694', true)",
    );
    prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2027-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 7, 7);
       insert into scenic_grade_groups (division_id, grade, level) select id, 7, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('Magic', 'Boys', 7, 7, 'COMP', '9913694', '9913694', 'Earl Epps', 'Earl Epps')`,
    );
    team = (await db.pool.query<{ id: string }>("select id::text from scenic_teams where name = 'Magic'")).rows[0].id;
    await db.pool.query(
      `insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select ${prog}, ${team}, id, 'Earl Epps' from scenic_pools`,
    );
  });

  it("moves a Solo team into its own account: Owner, CourtSolo, one team named for it, still (Solo) in the League", async () => {
    const slug = await withTx(db.pool, (q) => makeSoloAccount(q, team, "Earl Epps", now));
    expect(slug).toBe("magic");
    expect((await db.pool.query("select name, kind from organizations where slug = 'magic'")).rows[0]).toEqual({
      name: "Magic",
      kind: "Team",
    });
    expect([...(await orgFeatureKeys(db.pool, "magic"))].sort()).toEqual(["alerts", "court-solo"]);
    expect((await orgFeatures(db.pool, "magic")).has("team-building")).toBe(true);
    const roles = await db.pool.query("select role from org_roles where coach_id = '9913694' and org = 'magic' order by role");
    expect(roles.rows.map((r) => r.role)).toEqual(["Admin", "Coach", "Director", "Owner"]);
    const t = await db.pool.query(
      `select ot.name, c.coach_id, c.role, st.owner_coach_id, st.name as copy from org_teams ot
         join org_team_coaches c on c.team_id = ot.id join scenic_teams st on st.org_team_id = ot.id where ot.org = 'magic'`,
    );
    expect(t.rows).toEqual([{ name: "Magic", coach_id: "9913694", role: "HeadCoach", owner_coach_id: null, copy: "Magic" }]);
    // Still registered, and shown as (Solo).
    expect((await publicLeague(db.pool, now, prog))?.groups[0].teams).toEqual([{ id: expect.any(String), name: "Magic", tag: "Solo" }]);

    // One team only.
    expect(
      await createOrgTeam(deps(), earl, "magic", { gender: "Boys", grades: ["6"], level: "REC", headCoach: "none" }),
    ).toEqual({ ok: false, message: "A CourtSolo account has one team: it can't add or import teams." });
    // Renaming the account renames the team, here and in the League.
    expect(await renameOrg(deps(), earl, "magic", { name: "Magic Elite", short: "Magic Elite" })).toMatchObject({ ok: true });
    expect((await db.pool.query("select name from org_teams")).rows).toEqual([{ name: "Magic Elite" }]);
    // Its copy in Scenic City's lists (partners) follows the new name.
    expect(
      (await db.pool.query("select p.name from partners p join organizations o on o.slug = p.org_slug where o.name = 'Magic Elite'")).rows,
    ).toEqual([{ name: "Magic Elite" }]);
    expect((await publicLeague(db.pool, now, prog))?.groups[0].teams).toEqual([{ id: expect.any(String), name: "Magic Elite", tag: "Solo" }]);
    // Not a Solo team any more.
    await expect(withTx(db.pool, (q) => makeSoloAccount(q, team, "Earl Epps", now))).rejects.toThrow();
  }, 60_000);

  it("one active team: archive is refused while its event runs; a new team replaces it; switching to CourtOrg keeps its name", async () => {
    const slug = await withTx(db.pool, (q) => makeSoloAccount(q, team, "Earl Epps", now));
    expect((await myAccounts(db.pool, "9913694", "2026-12-01")).solo).toEqual([
      { slug, name: "Magic", teamId: expect.any(String), teamName: "Magic", busyIn: "Winter", inPrograms: [prog] },
    ]);
    const newTeam = async (name: string) =>
      (
        await db.pool.query<{ id: string }>(
          `insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
           values ($1, 'Boys', 7, 7, 'COMP', '9913694', '9913694', 'Earl Epps', 'Earl Epps') returning id::text`,
          [name],
        )
      ).rows[0].id;
    // Still in Winter (until Feb 28): can't archive.
    const t1 = await newTeam("Thunderbolts");
    await expect(withTx(db.pool, (q) => replaceSoloTeam(q, slug, "9913694", t1, "Earl Epps", now, "2026-12-01"))).rejects.toThrow(
      /still in Winter/,
    );
    // After Winter ends: Magic is archived (history), the account takes the new team's name.
    await withTx(db.pool, (q) => replaceSoloTeam(q, slug, "9913694", t1, "Earl Epps", now, "2027-03-15"));
    expect(
      (await db.pool.query("select name, archived_by is not null as archived from org_teams where org = $1 order by id", [slug]))
        .rows,
    ).toEqual([
      { name: "Magic", archived: true },
      { name: "Thunderbolts", archived: false },
    ]);
    expect((await db.pool.query("select name from organizations where slug = $1", [slug])).rows[0].name).toBe("Thunderbolts");
    expect((await myAccounts(db.pool, "9913694", "2027-03-15")).solo[0]).toMatchObject({
      teamName: "Thunderbolts",
      busyIn: null,
    });

    // Switch to CourtOrg: the organization's name, CourtOrg on, the team keeps its name (abbreviation first in leagues).
    expect(await switchSoloToOrg(deps(), earl, slug, { name: "Hixson Hoops", short: "Hixson" })).toEqual({
      ok: true,
      slug: "hixson-hoops",
    });
    expect((await db.pool.query("select kind, abbr from organizations where slug = 'hixson-hoops'")).rows[0]).toEqual({
      kind: "Organization",
      abbr: "HH",
    });
    expect([...(await orgFeatureKeys(db.pool, "hixson-hoops"))].sort()).toEqual(["alerts", "court-org"]);
    expect((await db.pool.query("select name from scenic_teams where id = $1", [t1])).rows[0].name).toBe("HH Thunderbolts");
    expect((await myAccounts(db.pool, "9913694", "2027-03-15")).orgs).toEqual([{ slug: "hixson-hoops", name: "Hixson Hoops" }]);
    // Now it can add teams: COMP (REC needs CourtSync).
    expect(
      await createOrgTeam(deps(), earl, "hixson-hoops", { gender: "Boys", grades: ["6"], level: "REC", headCoach: "none" }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("CourtSync") });
    expect(
      await createOrgTeam(deps(), earl, "hixson-hoops", { gender: "Boys", grades: ["6"], level: "COMP", headCoach: "none" }),
    ).toMatchObject({ ok: true, name: "6B TBD" });
  }, 60_000);
});
