import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { createTestDb, grant } from "./testing/db";
import {
  deleteAnnouncement,
  listInbox,
  listSent,
  markRead,
  popupAnnouncements,
  previewAudience,
  sendAnnouncement,
  sendUnreadEmails,
  unreadCount,
} from "./announcements";

const person = (coachId: string, firstName: string, isDirector = false): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector,
  isCoach: true,
  requestPending: false,
  hasThunderRole: true,
});
const director = person("9913694", "Earl", true);
const head = person("5550001", "Hank");
const parent = person("5550004", "Paula");

describe("announcements", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  let now = new Date("2026-10-28T12:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const hours = (h: number) => (now = new Date(now.getTime() + h * 3_600_000));
  let teamA = "";
  let teamB = "";
  const msg = { title: "Gym change", body: "Practice moves to Heritage.\nSee you there." };

  beforeEach(async () => {
    await db.reset();
    now = new Date("2026-10-28T12:00:00Z");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell, email, active) values
         ('9913694', 'Earl', 'X', '4239913694', 'earl@example.com', true),
         ('5550001', 'Hank', 'X', '4235550001', 'hank@example.com', true),
         ('5550002', 'Amy', 'X', '4235550002', 'amy@example.com', true),
         ('5550003', 'Cole', 'X', '4235550003', null, true),
         ('5550004', 'Paula', 'X', '4235550004', 'paula@example.com', true),
         ('5550005', 'Ina', 'X', '4235550005', 'ina@example.com', false),
         ('5550006', 'Rex', 'X', '4235550006', 'rex@example.com', true)`,
    );
    await grant(
      db.pool,
      "9913694 thunder Director",
      "5550001 thunder Coach",
      "5550002 thunder Coach",
      "5550003 thunder Coach",
      "5550005 thunder Coach",
      "5550006 thunder Request",
    );
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x'), ('5B B', 'Boys', '{5}', 5, 'COMP', 'x') returning id::text`,
    );
    [teamA, teamB] = t.rows.map((r) => r.id);
    await db.pool.query(
      `insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x'), ($1, '5550004', 'TeamParent', 'x'), ($2, '5550002', 'HeadCoach', 'x'), ($2, '5550003', 'AsstCoach', 'x')`,
      [teamA, teamB],
    );
  });

  const names = async (a: object) => {
    const r = await previewAudience(deps(), director, a);
    return r.ok ? r.names.map((n) => n.split(" ")[0]) : r.message;
  };

  it("picks people by everyone, role, team or name; never inactive, pending, or the sender", async () => {
    expect(await names({ everyone: true })).toEqual(["Amy", "Cole", "Hank", "Paula"]);
    expect(await names({ roles: ["HeadCoach"] })).toEqual(["Amy", "Hank"]);
    expect(await names({ roles: ["TeamParent", "AsstCoach"] })).toEqual(["Cole", "Paula"]);
    expect(await names({ teams: [teamA] })).toEqual(["Hank", "Paula"]);
    expect(await names({ users: ["5550002", "5550005", "5550006"] })).toEqual(["Amy"]);
    expect(await names({ roles: ["AsstCoach"], users: ["5550001"] })).toEqual(["Cole", "Hank"]);
    expect(await names({ roles: ["nope"], teams: ["x"], users: ["'; drop"] })).toEqual([]);
    expect(await names({})).toEqual([]);
  });

  it("a practice day reaches the staff of every team practicing that day (Eastern time)", async () => {
    const g = await db.pool.query<{ id: string }>("insert into gyms (name) values ('Gym') returning id::text");
    const c = await db.pool.query<{ id: string }>("insert into courts (gym_id, name) values ($1, 'Main') returning id::text", [
      g.rows[0].id,
    ]);
    await db.pool.query(
      `insert into slots (court_id, starts_at, team_id, created_by) values
         ($1, '2026-11-10T23:00:00Z', $2, 'x'),  -- Tue 6 PM Eastern: team A
         ($1, '2026-11-11T03:30:00Z', $3, 'x'),  -- Tue 10:30 PM Eastern (Wed in UTC): team B
         ($1, '2026-11-11T18:00:00Z', null, 'x')`,
      [c.rows[0].id, teamA, teamB],
    );
    expect(await names({ practiceDate: "2026-11-10" })).toEqual(["Amy", "Cole", "Hank", "Paula"]);
    expect(await names({ practiceDate: "2026-11-11" })).toEqual([]);
    expect(await names({ practiceDate: "11/10" })).toEqual([]);
    const r = await sendAnnouncement(deps(), director, { ...msg, practiceDate: "2026-11-10" });
    expect(r).toMatchObject({ ok: true, count: 4 });
    expect((await listSent(deps(), director))[0].audience).toBe("Practicing Tue, 11/10");
  });

  it("volunteers: in the app if they have a login, otherwise emailed right away (once per address)", async () => {
    const reg = (id: string, first: string, cell: string, email: string | null, interest: string | null) =>
      db.pool.query(
        `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program,
                                    parent1_first, parent1_cell, parent1_email, coaching_interest, raw, imported_at, imported_by)
         values ($1, $1, 'Kid', 'X', 'Girls', '4', 4, '4th Girls', $2, $3, $4, $5, '{}', now(), 'x')`,
        [id, first, cell, email, interest],
      );
    await reg("1", "Amy", "4235550002", "amy@example.com", "Head Coach"); // has a login
    await reg("2", "Vic", "4235559001", "vic@example.com", "Assistant Coach"); // no login
    await reg("3", "Vic", "4235559001", "VIC@example.com", "Assistant Coach"); // second child, same parent
    await reg("4", "Nora", "4235559002", null, "Head Coach"); // no login, no email
    await reg("5", "Pat", "4235559003", "pat@example.com", null); // didn't volunteer
    expect(await previewAudience(deps(), director, { volunteers: true })).toEqual({ ok: true, names: ["Amy X"], emailOnly: 1 });

    const mail: { to: string; subject: string; text: string }[] = [];
    const r = await sendAnnouncement(
      { ...deps(), sendEmail: async (to, subject, text) => void mail.push({ to, subject, text }) },
      director,
      {
        ...msg,
        volunteers: true,
      },
    );
    expect(r).toMatchObject({ ok: true, count: 1, emailed: 1 });
    expect(mail).toEqual([
      { to: "vic@example.com", subject: "Thunder Basketball: Gym change", text: expect.stringContaining("Practice moves to Heritage.") },
    ]);
    expect((await listSent(deps(), director))[0]).toMatchObject({ audience: "Volunteer coaches", total: 1, emailed: 1 });
  });

  it("sends to the picked people, describes who it went to, and checks the input", async () => {
    const r = await sendAnnouncement(deps(), director, { ...msg, roles: ["HeadCoach"], teams: [teamA] });
    expect(r).toMatchObject({ ok: true, count: 3 });
    const sent = await listSent(deps(), director);
    expect(sent[0]).toMatchObject({ title: "Gym change", audience: "Head Coaches · 4G A", sentBy: "Earl X", total: 3 });
    expect(sent[0].unread).toEqual(["Amy X", "Hank X", "Paula X"]);

    expect(await sendAnnouncement(deps(), director, { ...msg, title: " ", everyone: true })).toEqual({
      ok: false,
      message: "Add a title.",
    });
    expect(await sendAnnouncement(deps(), director, { ...msg, body: "x".repeat(4001), everyone: true })).toMatchObject({ ok: false });
    expect(await sendAnnouncement(deps(), director, { ...msg, users: ["5550005"] })).toEqual({
      ok: false,
      message: "Pick who should get it. Nobody matches yet.",
    });
    expect(await sendAnnouncement(deps(), head, { ...msg, everyone: true })).toEqual({
      ok: false,
      message: "Only the organization's Directors can send alerts.",
    });
    expect((await previewAudience(deps(), head, { everyone: true })).ok).toBe(false);
  });

  it("the Director can remove one: gone from every inbox and never emailed", async () => {
    const r = await sendAnnouncement(deps(), director, { ...msg, everyone: true });
    if (!r.ok) throw new Error(r.message);
    expect(await deleteAnnouncement(deps(), head, r.id)).toEqual({ ok: false, message: "Only the organization's Directors can remove its alerts." });
    expect(await unreadCount(deps(), head)).toBe(1);
    expect(await deleteAnnouncement(deps(), director, r.id)).toEqual({ ok: true });
    expect(await listInbox(deps(), head)).toEqual([]);
    expect(await unreadCount(deps(), head)).toBe(0);
    expect(await listSent(deps(), director)).toEqual([]);
    expect(await deleteAnnouncement(deps(), director, r.id)).toMatchObject({ ok: false });
    expect(await deleteAnnouncement(deps(), director, "1; drop table users")).toMatchObject({ ok: false });
    const mail: string[] = [];
    hours(9);
    expect(await sendUnreadEmails({ ...deps(), appUrl: "x", sendEmail: async (to) => void mail.push(to) })).toBe(0);
  });

  it("every organization: its Directors alert its own people (roles, teams), never another organization's", async () => {
    await db.pool.query("delete from org_role_types where org = 'east-ridge'");
    await db.pool.query("delete from organizations where slug = 'east-ridge'");
    await db.pool.query(
      "insert into organizations (slug, name, short_name, kind) values ('east-ridge', 'East Ridge', 'ER', 'Organization')",
    );
    await db.pool.query("insert into org_role_types (org, role) values ('east-ridge', 'Director'), ('east-ridge', 'Coach')");
    await grant(db.pool, "5550006 east-ridge Director", "5550001 east-ridge Coach", "5550002 east-ridge Coach");
    const t = await db.pool.query<{ id: string }>(
      `insert into org_teams (org, name, gender, grade_low, grade, level, created_by)
       values ('east-ridge', '5B Hank', 'Boys', 5, 5, 'REC', 'x'), ('east-ridge', '6B Amy', 'Boys', 6, 6, 'REC', 'x') returning id::text`,
    );
    const [er5, er6] = t.rows.map((r) => r.id);
    await db.pool.query(
      `insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x'), ($2, '5550002', 'HeadCoach', 'x'), ($2, '5550003', 'AsstCoach', 'x')`,
      [er5, er6],
    );
    const rex = person("5550006", "Rex");
    const er = (a: object) => previewAudience(deps(), rex, { org: "east-ridge", ...a });
    const first = (r: Awaited<ReturnType<typeof er>>) => (r.ok ? r.names.map((n) => n.split(" ")[0]) : r.message);
    expect(first(await er({ everyone: true }))).toEqual(["Amy", "Cole", "Hank"]); // not Earl or Paula (Thunder only)
    expect(first(await er({ teams: [er6] }))).toEqual(["Amy", "Cole"]);
    expect(first(await er({ roles: ["AsstCoach"] }))).toEqual(["Cole"]);
    expect(first(await er({ teams: [teamA] }))).toEqual([]); // Thunder's team ids reach nobody here
    // Thunder's Director isn't East Ridge's; East Ridge's isn't Thunder's.
    expect(await sendAnnouncement(deps(), director, { ...msg, org: "east-ridge", everyone: true })).toMatchObject({ ok: false });
    expect(await previewAudience(deps(), rex, { everyone: true })).toMatchObject({ ok: false });
    const r = await sendAnnouncement(deps(), rex, { ...msg, org: "east-ridge", teams: [er5] });
    expect(r).toMatchObject({ ok: true, count: 1 });
    expect((await listInbox(deps(), head))[0]).toMatchObject({ title: "Gym change", orgName: "East Ridge" });
    expect((await listSent(deps(), rex, "east-ridge")).map((x) => x.audience)).toEqual(["5B Hank"]);
    expect(await listSent(deps(), director)).toEqual([]); // Thunder's Sent has only Thunder's
    if (r.ok) expect(await deleteAnnouncement(deps(), director, r.id)).toMatchObject({ ok: false });
  });

  it("pop-up: unread and under 24 hours old, oldest first, until acknowledged", async () => {
    await sendAnnouncement(deps(), director, { ...msg, users: ["5550001"] });
    hours(2);
    await sendAnnouncement(deps(), director, { title: "Second", body: "2", users: ["5550001"] });
    expect((await popupAnnouncements(deps(), head)).map((a) => a.title)).toEqual(["Gym change", "Second"]);
    expect(await popupAnnouncements(deps(), parent)).toEqual([]);

    hours(22.5); // the first is now 24.5 hours old: inbox only
    const pop = await popupAnnouncements(deps(), head);
    expect(pop.map((a) => a.title)).toEqual(["Second"]);
    await markRead(deps(), head, pop.map((a) => a.id)); // Got it
    expect(await popupAnnouncements(deps(), head)).toEqual([]);
    expect(await unreadCount(deps(), head)).toBe(1); // the older one is still unread in the inbox
  });

  it("inbox: only your own, newest first; opening marks read", async () => {
    await sendAnnouncement(deps(), director, { ...msg, teams: [teamA] });
    hours(1);
    await sendAnnouncement(deps(), director, { title: "Second", body: "Hi", users: ["5550002"] });
    expect((await listInbox(deps(), head)).map((i) => [i.title, i.read])).toEqual([["Gym change", false]]);
    expect(await listInbox(deps(), person("5550002", "Amy"))).toMatchObject([{ title: "Second" }]);
    expect(await unreadCount(deps(), head)).toBe(1);

    const [item] = await listInbox(deps(), head);
    await markRead(deps(), head, [item.id]);
    expect(await unreadCount(deps(), head)).toBe(0);
    expect(await unreadCount(deps(), parent)).toBe(1); // marking your own doesn't touch anyone else's
    expect((await listSent(deps(), director)).find((s) => s.title === "Gym change")?.unread).toEqual(["Paula X"]);
  });

  it("unread after 8 hours: one summary email each, never twice, at most every 8 hours", async () => {
    const mail: { to: string; subject: string; text: string }[] = [];
    const run = () =>
      sendUnreadEmails({
        ...deps(),
        appUrl: "https://app.example",
        sendEmail: async (to, subject, text) => void mail.push({ to, subject, text }),
      });

    await sendAnnouncement(deps(), director, { ...msg, everyone: true });
    hours(1);
    await sendAnnouncement(deps(), director, { title: "Second", body: "Two", roles: ["HeadCoach"] });
    const [first] = await listInbox(deps(), person("5550002", "Amy"));
    await markRead(deps(), person("5550002", "Amy"), [first.id]); // Amy read the newer one only

    hours(6.9);
    expect(await run()).toBe(0); // first one is 7.9 hours old

    hours(0.2);
    expect(await run()).toBe(3); // Amy, Hank, Paula (Cole has no email)
    expect(mail.map((m) => [m.to, m.subject]).sort()).toEqual([
      ["amy@example.com", "Thunder Basketball: 1 unread announcement"],
      ["hank@example.com", "Thunder Basketball: 1 unread announcement"],
      ["paula@example.com", "Thunder Basketball: 1 unread announcement"],
    ]);
    const amy = mail.find((m) => m.to === "amy@example.com")!.text;
    expect(amy).toContain("■ Gym change");
    expect(amy).toContain("Practice moves to Heritage.\nSee you there.");
    expect(amy).toContain("https://app.example/inbox");
    expect(await run()).toBe(0); // nothing new

    hours(1); // Hank's "Second" is now 8+ hours old, but he was emailed 1 hour ago
    expect(await run()).toBe(0);
    hours(7);
    expect(await run()).toBe(1);
    expect(mail.at(-1)).toMatchObject({ to: "hank@example.com", subject: "Thunder Basketball: 1 unread announcement" });
    expect(mail.at(-1)?.text).toContain("■ Second");

    // Reading in the app stops the email.
    await sendAnnouncement(deps(), director, { title: "Third", body: "3", users: ["5550004"] });
    const [third] = await listInbox(deps(), parent);
    await markRead(deps(), parent, [third.id]);
    hours(9);
    expect(await run()).toBe(0);
  });
});
