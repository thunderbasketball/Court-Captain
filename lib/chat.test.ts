import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { chatBox, chatEmailSetting, chatLevel, setChatEmailSetting, chatUnreadCount, dmKey, getChat, listChats, markChatRead, newChatOptions, postMessage, sendUnreadChatEmails } from "./chat";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string, isDirector = false): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector,
  isCoach: true,
  requestPending: false,
  hasThunderRole: true,
});
const dir = person("9913694", "Dee", true);
const cal = person("5550001", "Cal"); // Coach role, Head Coach of team A
const ace = person("5550002", "Ace"); // Assistant Coach of team B (no Coach role on the user record)
const pam = person("5550003", "Pam"); // Team Parent on team A
const max = person("5550004", "Max"); // Manager on team B

describe("chat", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });
  let now = new Date("2026-10-28T12:00:00Z");
  const deps = () => ({ pool: db.pool, now: () => now });
  const later = (minutes: number) => (now = new Date(now.getTime() + minutes * 60_000));
  let A = "";
  let B = "";

  beforeEach(async () => {
    await db.reset();
    now = new Date("2026-10-28T12:00:00Z");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell, email) values
         ('9913694', 'Dee', 'X', '4239913694', 'dee@example.com'),
         ('5550001', 'Cal', 'X', '4235550001', 'cal@example.com'),
         ('5550002', 'Ace', 'X', '4235550002', 'ace@example.com'),
         ('5550003', 'Pam', 'X', '4235550003', 'pam@example.com'),
         ('5550004', 'Max', 'X', '4235550004', null)`,
    );
    await grant(db.pool, "9913694 thunder Director", "5550001 thunder Coach");
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x'), ('5B B', 'Boys', '{5}', 5, 'REC', 'x') returning id::text`,
    );
    [A, B] = t.rows.map((r) => r.id);
    await db.pool.query(
      `insert into team_staff (team_id, coach_id, role, added_by) values
         ($1, '5550001', 'HeadCoach', 'x'), ($1, '5550003', 'TeamParent', 'x'), ($2, '5550002', 'AsstCoach', 'x'), ($2, '5550004', 'Manager', 'x')`,
      [A, B],
    );
  });

  const keys = async (u: SessionUser) => (await newChatOptions(deps(), u)).map((o) => o.key);
  const post = async (u: SessionUser, key: string, body = "hi") => {
    later(1);
    return postMessage(deps(), u, key, body);
  };

  const eastRidge = async (...features: string[]) => {
    await db.pool.query("delete from org_role_types where org = 'east-ridge'");
    await db.pool.query("delete from organizations where slug = 'east-ridge'");
    await db.pool.query("insert into organizations (slug, name, short_name, kind) values ('east-ridge', 'East Ridge', 'ER', 'Organization')");
    await db.pool.query("insert into org_role_types (org, role) values ('east-ridge', 'Director'), ('east-ridge', 'Coach')");
    for (const f of features)
      await db.pool.query("insert into org_features (org, feature, source, turned_on_by) values ('east-ridge', $1, 'setup', 'test')", [f]);
  };

  it("chats follow features: CourtPlayers every chat, CourtTeams the Directors' only, others none", async () => {
    await eastRidge("court-sync");
    await grant(db.pool, "5550004 east-ridge Director", "5550002 east-ridge Coach");
    const erDir = person("5550004", "Max");
    expect(await chatLevel(db.pool, "east-ridge")).toBe("none");
    expect(await newChatOptions(deps(), erDir, "east-ridge")).toEqual([]);
    expect(await post(erDir, "east-ridge~directors")).toMatchObject({ ok: false });
    await db.pool.query("insert into org_features (org, feature, source, turned_on_by) values ('east-ridge', 'court-teams', 'setup', 'test')");
    expect(await chatLevel(db.pool, "east-ridge")).toBe("directors");
    expect((await newChatOptions(deps(), erDir, "east-ridge")).map((o) => o.key)).toEqual(["east-ridge~directors"]);
    expect((await newChatOptions(deps(), ace, "east-ridge")).map((o) => o.key)).toEqual(["east-ridge~coach-5550002"]); // a coach there: their chat with the Directors
    expect(await post(erDir, "east-ridge~directors")).toMatchObject({ ok: true });
    expect(await post(erDir, "east-ridge~coaches")).toMatchObject({ ok: false }); // own-coach chats need CourtPlayers
    expect(await post(erDir, dmKey("5550004", "5550002", "east-ridge"))).toMatchObject({ ok: true });
    await db.pool.query("insert into org_features (org, feature, source, turned_on_by) values ('east-ridge', 'court-players', 'setup', 'test')");
    expect(await post(erDir, "east-ridge~coaches")).toMatchObject({ ok: true });
    // Dropping CourtPlayers hides its chats (kept, not deleted).
    await db.pool.query("delete from org_features where org = 'east-ridge' and feature = 'court-players'");
    expect(await getChat(deps(), erDir, "east-ridge~coaches")).toBeNull();
    expect((await listChats(deps(), erDir)).map((c) => c.key).filter((k) => k.startsWith("east-ridge~"))).toEqual([
      dmKey("5550004", "5550002", "east-ridge"),
      "east-ridge~directors",
    ]);
  });

  it("CourtTeams: Directors chat with each program's registered teams' coaches, and one coach", async () => {
    await db.pool.query("delete from org_features where org = 'scenic-city'");
    await db.pool.query("insert into org_features (org, feature, source, turned_on_by) values ('scenic-city', 'court-teams', 'setup', 'test')");
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550009', 'Sue', 'S', '4235550009')");
    await grant(db.pool, "5550009 scenic-city Director");
    const sue = person("5550009", "Sue");
    const prog = (
      await db.pool.query<{ id: string }>(
        `insert into scenic_programs (kind, name, starts_on, ends_on, reg_opens, reg_closes, created_by, updated_by)
         values ('League', 'Winter', '2026-12-05', '2099-02-28', '2026-10-01', '2027-02-14', 't', 't') returning id::text`,
      )
    ).rows[0].id;
    await db.pool.query(
      `insert into scenic_divisions (program_id, gender, grade_low, grade_high) values (${prog}, 'Boys', 5, 5);
       insert into scenic_grade_groups (division_id, grade, level) select id, 5, 'COMP' from scenic_divisions;
       insert into scenic_pools (group_id, name) select id, 'A' from scenic_grade_groups;
       insert into scenic_teams (name, gender, grade_low, grade, level, owner_coach_id, coach_id, created_by, updated_by)
         values ('Magic', 'Boys', 5, 5, 'COMP', '5550002', '5550002', 't', 't'), ('Gone', 'Boys', 5, 5, 'COMP', '5550003', '5550003', 't', 't');
       insert into scenic_teams (name, gender, grade_low, grade, level, thunder_team_id, owner_coach_id, created_by, updated_by)
         values ('Thunder 4G A', 'Girls', 4, 4, 'COMP', ${A}, '9913694', 't', 't'); -- a club team: its Head Coach (Cal) counts
       insert into scenic_registrations (program_id, team_id, pool_id, registered_by)
         select ${prog}, t.id, (select id from scenic_pools), 't' from scenic_teams t;
       update scenic_registrations set removed_by = 't' where team_id = (select id from scenic_teams where name = 'Gone');`,
    );
    const progKey = `scenic-city~program-${prog}`;
    expect((await newChatOptions(deps(), sue, "scenic-city")).map((o) => o.key)).toEqual([
      "scenic-city~directors",
      progKey,
      "scenic-city~coach-5550002", // Ace coaches a registered team; Pam's team was removed
      "scenic-city~coach-5550001", // Cal: Head Coach of the club team registered
    ]);
    expect((await newChatOptions(deps(), cal, "scenic-city")).map((o) => o.key)).toEqual(["scenic-city~coach-5550001", progKey]);
    expect((await newChatOptions(deps(), ace, "scenic-city")).map((o) => o.key)).toEqual(["scenic-city~coach-5550002", progKey]);
    expect(await newChatOptions(deps(), pam, "scenic-city")).toEqual([]);
    expect(await post(sue, progKey, "Schedules are out")).toMatchObject({ ok: true });
    expect(await chatUnreadCount(deps(), ace)).toBe(1);
    expect((await getChat(deps(), ace, progKey))?.members).toEqual(["Sue S", "Ace X", "Cal X"]);
    expect((await listChats(deps(), ace)).map((c) => c.title)).toEqual(["Winter · Coaches · Scenic City"]);
    expect(await getChat(deps(), pam, progKey)).toBeNull();
    expect(await post(sue, "scenic-city~coach-5550002", "Got a minute?")).toMatchObject({ ok: true });
    expect(await post(ace, "scenic-city~coach-5550002", "Sure")).toMatchObject({ ok: true });
    expect(await post(sue, "scenic-city~coach-5550003")).toMatchObject({ ok: false }); // not a coach there any more
    expect(await post(sue, "scenic-city~coaches")).toMatchObject({ ok: false }); // own-coach chats need CourtPlayers
  });

  it("CourtSync: the Scheduler's and the host's Facilities people chat while the hosting is approved", async () => {
    await eastRidge("court-sync"); // a host only: no chats of its own
    await db.pool.query(
      "insert into org_features (org, feature, source, turned_on_by) values ('scenic-city', 'court-teams', 'setup', 'test'), ('scenic-city', 'court-sync', 'setup', 'test') on conflict do nothing",
    );
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550009', 'Sue', 'S', '4235550009')");
    await db.pool.query("insert into org_role_types (org, role) values ('east-ridge', 'Admin') on conflict do nothing");
    await grant(db.pool, "5550009 scenic-city Admin", "5550004 east-ridge Admin", "5550002 east-ridge Coach");
    const sue = person("5550009", "Sue");
    const erAdmin = person("5550004", "Max");
    const key = "scenic-city~host-east-ridge";
    // Not approved yet: no chat.
    await db.pool.query(
      "insert into org_partnerships (host_org, for_org, status, requested_by) values ('east-ridge', 'scenic-city', 'pending', 'x')",
    );
    expect(await post(sue, key)).toMatchObject({ ok: false });
    expect(await newChatOptions(deps(), erAdmin, "east-ridge")).toEqual([]);
    await db.pool.query("update org_partnerships set status = 'approved' where host_org = 'east-ridge'");
    // Each side sees it from its own organization, named for the other side.
    expect(await newChatOptions(deps(), erAdmin, "east-ridge")).toEqual([{ key, title: "Scenic City Basketball · CourtSync", group: "CourtSync" }]);
    expect((await newChatOptions(deps(), sue, "scenic-city")).filter((o) => o.group === "CourtSync")).toEqual([
      { key, title: "East Ridge · CourtSync", group: "CourtSync" },
    ]);
    expect(await post(erAdmin, key, "Gym 2 is closed Saturday")).toMatchObject({ ok: true });
    expect(await chatUnreadCount(deps(), sue)).toBe(1);
    expect((await getChat(deps(), sue, key))?.members).toEqual(["Sue S", "Max X"]); // by last name
    expect((await chatBox(deps(), erAdmin, "east-ridge")).map((g) => g.name)).toEqual(["CourtSync"]);
    // Not for their coaches, Thunder, or the other side's coaches.
    expect(await getChat(deps(), ace, key)).toBeNull();
    expect(await getChat(deps(), dir, key)).toBeNull();
    expect(await post(sue, "scenic-city~host-scenic-city")).toMatchObject({ ok: false });
    // The host turns CourtSync off: the chat is hidden (kept).
    await db.pool.query("delete from org_features where org = 'east-ridge' and feature = 'court-sync'");
    expect(await getChat(deps(), sue, key)).toBeNull();
    expect(await chatUnreadCount(deps(), sue)).toBe(0);
  });

  it("every organization with Chat: its own chats, its own people, kept apart from Thunder's", async () => {
    await eastRidge("court-players");
    await grant(db.pool, "5550004 east-ridge Director", "5550002 east-ridge Coach");
    const t = await db.pool.query<{ id: string }>(
      `insert into org_teams (org, name, gender, grade_low, grade, level, created_by) values ('east-ridge', '5B Ace', 'Boys', 5, 5, 'REC', 'x') returning id::text`,
    );
    const er = t.rows[0].id;
    await db.pool.query("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550002', 'HeadCoach', 'x')", [er]);
    const erDir = person("5550004", "Max");
    // East Ridge's Director starts East Ridge's chats; its keys carry its address.
    const opts = (await newChatOptions(deps(), erDir, "east-ridge")).map((o) => o.key);
    expect(opts.slice(0, 3)).toEqual(["east-ridge~directors", "east-ridge~everyone", "east-ridge~coaches"]);
    expect(opts).toContain(`east-ridge~team-${er}`);
    expect(opts).toContain("east-ridge~coach-5550002");
    expect(opts).not.toContain("east-ridge~coach-5550001"); // Thunder's coach isn't East Ridge's
    expect(await post(erDir, "east-ridge~coaches", "Gym is open")).toMatchObject({ ok: true });
    // Ace (East Ridge's Head Coach) gets it; Thunder's coaches and Thunder's Director (not East Ridge's) don't see it.
    expect(await chatUnreadCount(deps(), ace)).toBe(1);
    expect((await listChats(deps(), ace)).map((c) => c.title)).toEqual(["Coaches · ER"]);
    expect(await getChat(deps(), cal, "east-ridge~coaches")).toBeNull();
    expect(await getChat(deps(), dir, "east-ridge~coaches")).toBeNull();
    expect((await getChat(deps(), ace, "east-ridge~coaches"))?.members).toEqual(["Ace X"]);
    // Thunder's "coaches" chat is a different chat.
    expect((await getChat(deps(), cal, "coaches"))?.messages).toEqual([]);
    expect(await post(dir, `east-ridge~team-${er}`)).toMatchObject({ ok: false });
    expect(await getChat(deps(), erDir, "east-ridge~event-1")).toBeNull(); // events are Thunder's
    // A private chat with a coach there.
    expect(await post(erDir, dmKey("5550004", "5550002", "east-ridge"))).toMatchObject({ ok: true });
    expect((await listChats(deps(), ace)).map((c) => c.title)).toContain("Max X · ER");
  });

  it("who can start what", async () => {
    expect(await keys(cal)).toEqual(["coach-5550001", "everyone", "coaches", `team-${A}`, `teamcoaches-${A}`]);
    expect(await keys(ace)).toEqual(["coach-5550002", "everyone", "coaches", `team-${B}`, `teamcoaches-${B}`]); // a team coach counts as a coach
    expect(await keys(pam)).toEqual([`team-${A}`]);
    const d = await keys(dir);
    expect(d.slice(0, 3)).toEqual(["directors", "everyone", "coaches"]);
    expect(d).toContain("coach-5550001");
    expect(d).toContain("coach-5550002");
    expect(d).not.toContain("coach-5550003"); // a Team Parent isn't a coach
    expect(d).toContain(`teamcoaches-${B}`);
  });

  it("each chat is only for its people; Directors can open every chat", async () => {
    expect(await post(cal, "coach-5550001", "Need a gym Tuesday")).toMatchObject({ ok: true });
    expect(await post(ace, "coach-5550001")).toEqual({ ok: false, message: "You can't post in this chat." });
    expect(await getChat(deps(), ace, "coach-5550001")).toBeNull();
    expect(await getChat(deps(), dir, "coach-5550001")).toMatchObject({ title: "Cal X · Directors", members: ["Cal X", "Dee X"] });
    expect(await getChat(deps(), cal, "coach-5550001")).toMatchObject({ title: "Directors" });

    expect(await post(pam, `team-${A}`, "Snacks Saturday")).toMatchObject({ ok: true });
    expect(await getChat(deps(), max, `team-${A}`)).toBeNull();
    expect(await getChat(deps(), pam, `teamcoaches-${A}`)).toBeNull();
    expect((await getChat(deps(), cal, `team-${A}`))?.members).toEqual(["Cal X", "Pam X"]); // Directors are hidden
    expect((await getChat(deps(), dir, `team-${A}`))?.messages.length).toBe(1); // but can read it
    expect(await post(pam, "coaches")).toMatchObject({ ok: false });
    expect(await post(pam, "directors")).toMatchObject({ ok: false });
    expect(await post(cal, "directors")).toMatchObject({ ok: false });

    expect(await post(dir, "coaches", "Directors can post here too")).toMatchObject({ ok: true });
    expect((await getChat(deps(), ace, "coaches"))?.members).toEqual(["Ace X", "Cal X"]);
    expect(await post(dir, "coach-5550003")).toEqual({ ok: false, message: "That person isn't an active coach." }); // Pam isn't a coach
  });

  it("an event chat is the event's check-in people + Directors", async () => {
    const e = await db.pool.query<{ id: string }>(
      `insert into events (name, starts_at, genders, grades, created_by) values ('Tryouts – Girls 4th Grade', now(), '{Girls}', '{4}', 'x') returning id::text`,
    );
    const id = e.rows[0].id;
    await db.pool.query("insert into event_staff (event_id, coach_id, added_by) values ($1, '5550004', 'x')", [id]);
    expect(await post(max, `event-${id}`, "Doors open 8:45")).toMatchObject({ ok: true });
    expect(await post(cal, `event-${id}`)).toMatchObject({ ok: false });
    expect(await getChat(deps(), dir, `event-${id}`)).toMatchObject({
      title: "Tryouts – Girls 4th Grade · Event",
      members: ["Dee X", "Max X"],
    });
    expect(await chatUnreadCount(deps(), dir)).toBe(1);
    await db.pool.query("delete from events where id = $1", [id]);
    expect(await getChat(deps(), dir, `event-${id}`)).toBeNull(); // event deleted: chat gone
  });

  it("chats a Director starts: only its people get alerts, other Directors can still read", async () => {
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('9900002', 'Dot', 'X', '4239900002')",
    );
    await grant(db.pool, "9900002 thunder Director");
    const dot = person("9900002", "Dot", true);
    const dm = dmKey(dir.coachId, cal.coachId);
    expect(dm).toBe(dmKey(cal.coachId, dir.coachId));
    expect(await post(dir, dm, "Can you cover Tuesday?")).toMatchObject({ ok: true });
    expect(await getChat(deps(), cal, dm)).toMatchObject({ title: "Dee X", members: ["Cal X", "Dee X"] });
    expect(await getChat(deps(), dir, dm)).toMatchObject({ title: "Cal X" });
    expect(await getChat(deps(), dot, dm)).toMatchObject({ title: "Cal X & Dee X" }); // another Director can read it
    expect(await getChat(deps(), ace, dm)).toBeNull();
    expect(await chatUnreadCount(deps(), cal)).toBe(1);
    expect(await chatUnreadCount(deps(), dot)).toBe(0); // …but isn't alerted

    // Team staff chat: Dee + everyone on team A (Head Coach and Team Parent).
    expect(await post(dir, `staff-${dir.coachId}-${A}`, "Uniforms Friday")).toMatchObject({ ok: true });
    expect(await getChat(deps(), pam, `staff-${dir.coachId}-${A}`)).toMatchObject({
      title: "4G A · Staff + Dee X",
      members: ["Cal X", "Dee X", "Pam X"],
    });
    expect(await getChat(deps(), ace, `staff-${dir.coachId}-${A}`)).toBeNull();
    expect(await chatUnreadCount(deps(), pam)).toBe(1);
    expect(await chatUnreadCount(deps(), dot)).toBe(0);

    // All Head Coaches: Dee + Cal (Ace is an Assistant).
    expect(await post(dir, `heads-${dir.coachId}`, "Meeting Monday")).toMatchObject({ ok: true });
    expect(await getChat(deps(), dir, `heads-${dir.coachId}`)).toMatchObject({ title: "All Head Coaches", members: ["Cal X", "Dee X"] });
    expect(await getChat(deps(), ace, `heads-${dir.coachId}`)).toBeNull();
    expect(await chatUnreadCount(deps(), cal)).toBe(3); // private chat, team A staff chat, Head Coaches
    expect(await chatUnreadCount(deps(), dot)).toBe(0);

    // Only Directors start these, and only with coaches; the lower id comes first in a private chat key.
    expect(await post(cal, `heads-${cal.coachId}`)).toMatchObject({ ok: false });
    expect(await post(cal, `staff-${cal.coachId}-${A}`)).toMatchObject({ ok: false });
    expect(await post(cal, dmKey(cal.coachId, ace.coachId))).toMatchObject({ ok: false });
    expect(await post(dir, dmKey(dir.coachId, pam.coachId))).toMatchObject({ ok: false }); // a Team Parent isn't a coach
    expect(await post(dir, "dm-9913694-5550001")).toMatchObject({ ok: false });
  });

  it("checks the message and the chat key", async () => {
    expect(await postMessage(deps(), cal, "everyone", "   ")).toEqual({ ok: false, message: "Type a message." });
    expect(await postMessage(deps(), cal, "everyone", "x".repeat(2001))).toMatchObject({ ok: false });
    expect(await postMessage(deps(), cal, "team-1; drop table users", "hi")).toMatchObject({ ok: false });
    expect(await getChat(deps(), dir, "coach-5550003")).toBeNull(); // not a coach
  });

  it("unread counts: your own messages don't count, opening a chat clears it, Directors aren't counted in the coaches' chat", async () => {
    await post(cal, "everyone", "one");
    await post(cal, "everyone", "two");
    await post(cal, "coaches", "coaches only");
    await post(pam, `team-${A}`, "team");
    expect(await chatUnreadCount(deps(), cal)).toBe(1); // Pam's team message
    expect(await chatUnreadCount(deps(), ace)).toBe(3); // everyone ×2 + coaches
    expect(await chatUnreadCount(deps(), dir)).toBe(2); // everyone ×2; not the coaches' chat or a team chat (hidden there)
    expect((await listChats(deps(), dir)).map((c) => [c.title, c.unread])).toEqual([
      ["4G A · Team", 0],
      ["Coaches", 0],
      ["Directors & all coaches", 2],
    ]);
    expect((await listChats(deps(), max)).map((c) => c.title)).toEqual([]);
    later(1);
    await markChatRead(deps(), ace, "everyone");
    expect(await chatUnreadCount(deps(), ace)).toBe(1);
    expect((await listChats(deps(), ace)).find((c) => c.key === "everyone")).toMatchObject({
      unread: 0,
      last: { body: "two", sender: "Cal X" },
    });
  });

  it("unread for 8 hours: one email per person, each message once, at most every 8 hours", async () => {
    const mail: { to: string; subject: string; text: string }[] = [];
    const run = () =>
      sendUnreadChatEmails({
        ...deps(),
        appUrl: "https://app.example",
        sendEmail: async (to, subject, text) => void mail.push({ to, subject, text }),
      });

    await post(cal, "everyone", "Practice plans posted");
    await post(pam, `team-${A}`, "Snacks Saturday");
    await markChatRead(deps(), dir, `team-${A}`); // Dee read the team chat
    later(8 * 60 - 3);
    expect(await run()).toBe(0);
    later(5);
    expect(await run()).toBe(3);
    expect(mail.map((m) => [m.to, m.subject]).sort()).toEqual([
      ["ace@example.com", "Thunder Basketball: 1 unread chat message"],
      ["cal@example.com", "Thunder Basketball: 1 unread chat message"],
      ["dee@example.com", "Thunder Basketball: 1 unread chat message"],
    ]);
    expect(mail.find((m) => m.to === "cal@example.com")?.text).toContain("■ 4G A · Team (1 unread)");
    expect(mail.find((m) => m.to === "dee@example.com")?.text).toContain("Cal X, ");
    expect(mail[0].text).toContain("https://app.example/chat");
    expect(await run()).toBe(0);

    await post(cal, "everyone", "Another");
    later(9 * 60);
    expect(await run()).toBe(2); // Ace and Dee; each message only once
    expect(mail.at(-1)?.text).not.toContain("Practice plans posted");
  });

  it("each organization's Chat setting: email after its own hours, or not at all; only its Admins change it", async () => {
    const mail: string[] = [];
    const run = () =>
      sendUnreadChatEmails({ ...deps(), appUrl: "https://app.example", sendEmail: async (to) => void mail.push(to) });
    expect(await chatEmailSetting(db.pool, "thunder")).toEqual({ on: true, hours: 8 });
    expect(await setChatEmailSetting({ pool: db.pool }, cal, "thunder", { on: true, hours: 2 })).toMatchObject({ ok: false });
    await grant(db.pool, "9913694 thunder Admin");
    expect(await setChatEmailSetting({ pool: db.pool }, dir, "thunder", { on: true, hours: 0 })).toMatchObject({ ok: false });
    expect(await setChatEmailSetting({ pool: db.pool }, dir, "thunder", { on: true, hours: 2 })).toEqual({ ok: true });

    await post(cal, "everyone", "Gym change");
    later(2 * 60 + 5);
    expect(await run()).toBe(2); // after 2 hours: Ace and Dee

    expect(await setChatEmailSetting({ pool: db.pool }, dir, "thunder", { on: false, hours: 2 })).toEqual({ ok: true });
    expect(await chatEmailSetting(db.pool, "thunder")).toEqual({ on: false, hours: 2 });
    await post(cal, "everyone", "Another");
    later(24 * 60);
    expect(await run()).toBe(0); // turned off
    expect(mail).toHaveLength(2);
  });

  it("a team's parents chat: its staff and its players' parents with a login; Directors can read but aren't members", async () => {
    const fam = person("5550005", "Fay");
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550005', 'Fay', 'X', '4235550005')");
    await db.pool.query(
      `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw, imported_at,
                                  imported_by, parent1_first, parent1_last, parent1_cell)
       values ('r1', 'r1', 'Kid', 'X', 'Girls', '4', 4, 'x', '{}', now(), 'x', 'Fay', 'X', '4235550005')`,
    );
    await db.pool.query(
      `insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at)
       values ($1, 'r1', 'Kid', 'X', 'Girls', '4', 4, 'x', now())`,
      [A],
    );
    expect(await postMessage(deps(), fam, `parents-${A}`, "Running late")).toMatchObject({ ok: true });
    later(1);
    expect(await postMessage(deps(), cal, `parents-${A}`, "No problem")).toMatchObject({ ok: true });
    const thread = await getChat(deps(), dir, `parents-${A}`);
    expect(thread?.title).toBe("4G A · Parents");
    expect(thread?.members).toEqual(["Cal X", "Fay X", "Pam X"]);
    // Another team's parents chat, and a stranger: no.
    expect(await getChat(deps(), fam, `parents-${B}`)).toBeNull();
    expect(await getChat(deps(), ace, `parents-${A}`)).toBeNull();
    expect(await getChat(deps(), fam, `east-ridge~parents-${A}`)).toBeNull();
    // The parent gets it in their list and unread count.
    expect(await chatUnreadCount(deps(), fam)).toBe(1);
  });

  it("the Chat box: every chat the person can open, grouped, each team's chats together", async () => {
    await post(cal, `team-${A}`, "practice moved");
    const names = (g: Awaited<ReturnType<typeof chatBox>>) => g.map((x) => x.name);
    // Cal (Head Coach of A): the group chats, then team A's chats (team, coaches, parents), with the unread message.
    const c = await chatBox(deps(), cal, "thunder");
    expect(names(c)).toEqual(["Groups", "Teams"]);
    expect(c[0].chats.map((x) => x.title)).toEqual(["Directors", "Directors & all coaches", "Coaches"]);
    expect(c[1].teams).toEqual([
      {
        name: "4G A",
        chats: [
          expect.objectContaining({ title: "Team chat", last: expect.objectContaining({ body: "practice moved" }) }),
          expect.objectContaining({ title: "Coaches", last: null }),
          expect.objectContaining({ title: "Parents", last: null }),
        ],
      },
    ]);
    // Pam (Team Parent on A) sees it unread; no coach groups.
    const p = await chatBox(deps(), pam, "thunder");
    expect(names(p)).toEqual(["Teams"]);
    expect(p[0].teams![0].chats.find((x) => x.title === "Team chat")!.unread).toBe(1);
    // A Director: Groups, every team, and each coach on their own.
    const d = await chatBox(deps(), dir, "thunder");
    expect(names(d)).toEqual(["Groups", "Teams", "Coaches"]);
    expect(d[1].teams!.map((t) => t.name)).toEqual(["5B B", "4G A"]); // as the Teams page: Boys first
    expect(d[2].chats.map((x) => x.title)).toContain("Cal X");
  });
});
