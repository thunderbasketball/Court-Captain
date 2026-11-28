import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { nudgeEmail, nudgeText, type NudgeContext } from "./coach-nudge-text";
import { noteTexts, nudgeList, nudgeRecipients, sendNudges } from "./coach-nudges";
import { createTestDb, grant } from "./testing/db";

const C: NudgeContext = { org: "club", orgName: "Club", link: "https://x.test/login/club", sender: "Ow N", next: "2026-12-05", today: "2026-11-28" };

describe("Reminders to coaches", () => {
  it("each coach's email: what's missing, why it matters, by when (urgent close to the Game Day); one short text for all", () => {
    const e = nudgeEmail("rosters", { first: "Pat", teams: [{ name: "5B C", missing: ["2 players without a birthdate"] }] }, C, "Please do this today.");
    expect(e.subject).toBe("Action needed: finish your roster by Thu, Dec 3");
    expect(e.text).toContain("Coach Pat,\n\nPlease do this today.\n\n5B C's roster isn't complete yet:\n  • 2 players without a birthdate");
    expect(e.text).toContain("rosters lock after your team's first game");
    expect(e.text).toContain("By when: Thursday, December 3, two days before the next Game Day (Saturday, December 5).");
    const late = nudgeEmail("rosters", { first: "Pat", teams: [{ name: "5B C", missing: ["no players on the roster yet"] }] }, { ...C, today: "2026-12-04" });
    expect(late.subject).toBe("URGENT: finish your roster today, games are Sat, Dec 5");
    expect(late.text).toContain("By when: TODAY. The next Game Day is Saturday, December 5 (tomorrow).");
    const u = nudgeEmail("use", { first: "Pat", teams: [{ name: "5B C", missing: [] }, { name: "6B C", missing: [] }] }, C);
    expect(u.subject).toBe("Your game times for Sat, Dec 5 are in CourtCaptain");
    expect(u.text).toContain("everything for 5B C and 6B C:");
    expect(nudgeText("rosters", C)).toContain("by Thu, Dec 3: https://x.test/login/club");
  });

  describe("sent", () => {
    let db: Awaited<ReturnType<typeof createTestDb>>;
    beforeAll(async () => {
      db = await createTestDb();
    }, 180_000);
    afterAll(async () => db?.drop());
    const who = (coachId: string, first = "Ow", last = "N") => ({ coachId, firstName: first, lastName: last, isDirector: true }) as unknown as SessionUser;
    const NOW = new Date("2026-11-28T15:00:00Z");

    it("only to coaches who need it, by Owners and Admins; live: each their own; test site: one to the sender; all kept", async () => {
      await db.pool.query(
        `insert into users (coach_id, first_name, last_name, cell, email, last_login_at) values
         ('5550001', 'Ow', 'N', '4235550001', 'ow@x.test', $1), ('5550002', 'Pat', 'A', '4235550002', 'pat@x.test', null),
         ('5550003', 'Sam', 'B', '4235550003', null, null), ('5550004', 'Kim', 'C', '4235550004', 'kim@x.test', $1)`,
        [NOW],
      );
      await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('club', 'Club', 'CL', 'Organization')");
      await db.pool.query("insert into org_role_types (org, role) values ('club', 'Owner'), ('club', 'Admin'), ('club', 'Coach') on conflict do nothing");
      await grant(db.pool, "5550001 club Owner", "5550001 club Admin");
      const team = async (name: string) =>
        (await db.pool.query<{ id: string }>("insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('club', $1, 'Boys', 5, 5, 'REC', 't') returning id::text", [name])).rows[0].id;
      const a = await team("5B A");
      const b = await team("5B B");
      await db.pool.query(
        "insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550002', 'HeadCoach', 't'), ($2, '5550003', 'HeadCoach', 't'), ($2, '5550004', 'AsstCoach', 't')",
        [a, b],
      );
      // 5B B's roster is complete; 5B A has nobody.
      await db.pool.query("insert into org_team_players (team_id, first_name, last_name, birthdate, grade, jersey, added_by) values ($1, 'Jo', 'D', '2015-10-01', 5, '3', 't')", [b]);

      // Not using the app: Pat and Sam (Kim logged in today). Rosters: only 5B A's Head Coach.
      expect((await nudgeRecipients(db.pool, "club", NOW, "use")).map((r) => r.name)).toEqual(["Pat A", "Sam B"]);
      const ros = await nudgeRecipients(db.pool, "club", NOW, "rosters");
      expect(ros).toMatchObject([{ name: "Pat A", teams: [{ name: "5B A", missing: ["no players on the roster yet"] }], cc: ["ow@x.test"] }]);
      // Sam (no email) on 5B B: copied to Kim, its Assistant Coach, and the Owner.
      expect((await nudgeRecipients(db.pool, "club", NOW, "use")).find((r) => r.name === "Sam B")?.cc).toEqual(["kim@x.test", "ow@x.test"]);

      const deps = { pool: db.pool, now: () => NOW };
      expect(await nudgeList(deps, who("5550004"), "club", "use", "https://x.test", true)).toBeNull(); // not an Admin
      const sent: { to: string; subject: string; text: string }[] = [];
      const mail = { ...deps, sendMail: async (m: { to: string; subject: string; text: string }) => void sent.push(m) };
      expect(await sendNudges(mail, who("5550004"), "club", "use", ["5550002"], "", "https://x.test", true)).toMatchObject({ ok: false });

      // Live: each coach their own (Sam has no email: listed to text instead). Kim isn't sent one, though asked for.
      expect(await sendNudges(mail, who("5550001"), "club", "use", ["5550002", "5550003", "5550004"], "", "https://x.test", true)).toEqual({ ok: true, sent: 1, noEmail: ["Sam B"] });
      // Copied: the club's Owner/Admin (Ow); 5B A has no other staff.
      expect(sent).toMatchObject([{ to: "pat@x.test", cc: ["ow@x.test"], subject: expect.stringContaining("CourtCaptain") }]);
      expect(sent[0].text).toContain("Coach Pat,");

      // Test site: one email to the sender, listing who'd get it; kept as a test (not shown as last sent).
      sent.length = 0;
      expect(await sendNudges(mail, who("5550001"), "club", "rosters", ["5550002"], "", "https://x.test", false)).toEqual({ ok: true, sent: 1, noEmail: [] });
      expect(sent).toMatchObject([{ to: "ow@x.test", subject: expect.stringMatching(/^\[TEST\] /) }]);
      expect(sent[0].text).toContain("Pat A <pat@x.test>: 5B A");

      expect(await noteTexts(deps, who("5550001"), "club", "use", ["5550003"], true)).toEqual({ ok: true, cells: ["4235550003"] });
      const after = await nudgeRecipients(db.pool, "club", NOW, "use");
      expect(after.map((r) => r.last?.channel ?? null)).toEqual(["email", "text"]);
      expect((await nudgeRecipients(db.pool, "club", NOW, "rosters"))[0].last).toBeNull();
    });
  });
});
