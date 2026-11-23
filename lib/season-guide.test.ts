import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { seasonGuidePreview, sendSeasonGuide, type GuideMail } from "./season-guide";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false }) as SessionUser;
const dee = person("9913694", "Dee"); // Scenic City Director of Teams
const ethan = person("5550101", "Ethan"); // a coach

describe("the season guide email", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());

  it("its Directors of Teams see every address first; test mode sends only to them (listing the addresses); live: To them, Cc staff, Bcc coaches", async () => {
    const now = new Date("2026-11-23T17:00:00Z");
    const deps = { pool: db.pool, now: () => now };
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell, email) values
         ('9913694', 'Dee', 'X', '4239913694', null), ('5550101', 'Ethan', 'Robinson', '7065062534', 'e@example.com')`,
    );
    await grant(db.pool, "9913694 scenic-city Director", "5550101 scenic-city Solo");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('9913694', 'scenic-city', 'teams', 'test')");
    const prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2099-02-28', '2026-10-01', '2099-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(`insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 4, 5)`);
    await db.pool.query("insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions");
    await db.pool.query("insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups");
    const team = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('5B Jackets Robinson', 'Boys', 5, 5, 'COMP', '5550101', '5550101', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into scenic_registrations (program_id, team_id, pool_id, registered_by, all_season) select ${prog}, ${team}, id, 't', true from scenic_pools`,
    );
    // An Assistant Coach with an email, and the same email twice: one email each.
    await db.pool.query(
      "insert into scenic_team_staff (team_id, role, first_name, last_name, cell, email, added_by) values ($1, 'AsstCoach', 'Al', 'Ash', '4235550808', 'al@example.com', 't')",
      [team],
    );

    // An organization's team in the League (its Admin is Cc'd) and Dee's email (the guide goes To her).
    await db.pool.query("update users set email = 'dee@example.com' where coach_id = '9913694'");
    await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('chatt', 'City of Chattanooga', 'Chatt', 'Organization') on conflict do nothing");
    await db.pool.query("insert into org_role_types (org, role) values ('chatt', 'Admin') on conflict do nothing");
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell, email) values ('5550301', 'Ada', 'X', '4235550301', 'ada@chatt.test')");
    await grant(db.pool, "5550301 chatt Admin");
    const ot = (
      await db.pool.query<{ id: string }>(
        "insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('chatt', '5B Chatt Lee', 'Boys', 5, 5, 'REC', 'x') returning id::text",
      )
    ).rows[0].id;
    await db.pool.query(
      "insert into partners (name, kind, hosts_games, registers_teams, approved, created_by, org_slug) values ('City of Chattanooga', 'Organization', false, true, true, 't', 'chatt')",
    );
    const copy = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_teams (name, gender, grade_low, grade, level, org_team_id, partner_id, created_by, updated_by)
         select '5B Chatt Lee', 'Boys', 5, 5, 'REC', $1, id, 't', 't' from partners where org_slug = 'chatt' returning id::text`,
        [ot],
      )
    ).rows[0].id;
    await db.pool.query(`insert into scenic_registrations (program_id, team_id, pool_id, registered_by) select ${prog}, ${copy}, id, 't' from scenic_pools`);

    const BASE = "https://app.test";
    expect(await seasonGuidePreview(deps, ethan, "scenic-city", BASE, false)).toMatchObject({ ok: false }); // a coach can't
    const p = await seasonGuidePreview(deps, dee, "scenic-city", BASE, false);
    if (!p.ok) throw new Error(p.message);
    expect(p).toMatchObject({ live: false, to: "dee@example.com", cc: ["ada@chatt.test"], bcc: ["al@example.com", "e@example.com"], teams: 2, last: null });
    expect(p.html).toContain("<strong");
    expect(p.html).toContain("Key dates: Winter");
    expect(p.html).toContain('<a href="https://app.test/login/scenic-city">');
    expect(p.html).toContain("• City of Chattanooga: <a href=\"https://app.test/login/chatt\">"); // each organization's login page
    expect(p.html).toContain("Add to Home Screen");
    expect(p.html).not.toContain("REC teams play one game");

    // Test mode: one email, to Dee only, listing every address.
    const sent: GuideMail[] = [];
    const mail = { ...deps, sendMail: async (m: GuideMail) => void sent.push(m) };
    expect(await sendSeasonGuide(mail, dee, "scenic-city", BASE, false)).toEqual({ ok: true, live: false, to: "dee@example.com", cc: 1, bcc: 2, emails: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "dee@example.com", subject: expect.stringMatching(/^\[TEST\]/) });
    expect(sent[0].cc).toBeUndefined();
    expect(sent[0].bcc).toBeUndefined();
    expect(sent[0].text).toContain("Bcc: coaches (2):");
    expect(sent[0].text).toContain("  ada@chatt.test");

    // Live: To Dee, Cc the organizations' staff, Bcc the coaches.
    sent.length = 0;
    expect(await sendSeasonGuide(mail, dee, "scenic-city", BASE, true)).toMatchObject({ ok: true, live: true, emails: 1 });
    expect(sent[0]).toMatchObject({ to: "dee@example.com", cc: ["ada@chatt.test"], bcc: ["al@example.com", "e@example.com"] });
    expect(sent[0].subject).not.toContain("[TEST]");
    expect(await seasonGuidePreview(deps, dee, "scenic-city", BASE, true)).toMatchObject({ ok: true, last: { by: "Dee X", total: 3, live: true } });
  }, 120_000);
});
