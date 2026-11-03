import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import {
  askQuestion,
  deleteArticle,
  listArticles,
  publishChat,
  replyChat,
  saveArticle,
  setChatResolved,
  supportChats,
} from "./support";
import { createTestDb } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const staff = person("5550001", "Sue");
const coach = person("5550002", "Cy");
const admin = person("5550003", "Al"); // Thunder Admin
const other = person("5550004", "Oz");

describe("Support", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const deps = () => ({ pool: db.pool, now: () => new Date("2026-11-02T15:00:00Z") });
  beforeEach(async () => {
    await db.reset();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Sue', 'X', '4235550001'),
         ('5550002', 'Cy', 'X', '4235550002'), ('5550003', 'Al', 'X', '4235550003'), ('5550004', 'Oz', 'X', '4235550004')`,
    );
    await db.pool.query("insert into platform_admins (coach_id, granted_by, role) values ('5550001', 'test', 'Owner')");
    await db.pool.query("select set_role('5550003', 'thunder', 'Admin', true, 'test')");
  });

  it("chats: New → Working → Resolved; staff see all, org Admins see their org's, others only their own", async () => {
    expect(await askQuestion(deps(), coach, "thunder", "  ")).toMatchObject({ ok: false });
    const t = await askQuestion(deps(), coach, "thunder", "How do I print a roster?");
    const p = await askQuestion(deps(), other, null, "Where is my login link?");
    if (!t.ok || !p.ok) throw new Error("ask failed");

    // Who sees what.
    expect((await supportChats(db.pool, coach, "thunder")).inbox).toBeNull();
    expect((await supportChats(db.pool, coach, "thunder")).mine.map((c) => c.id)).toEqual([t.id]);
    expect((await supportChats(db.pool, admin, "thunder")).inbox!.map((c) => c.id)).toEqual([t.id]);
    expect((await supportChats(db.pool, admin, "scenic")).inbox).toBeNull();
    expect((await supportChats(db.pool, staff, null)).inbox!.map((c) => c.id).sort()).toEqual([t.id, p.id].sort());

    const [chat] = (await supportChats(db.pool, coach, "thunder")).mine;
    expect(chat).toMatchObject({ who: "Cy X", status: "new", chattingWith: null });

    // Others can't reply or resolve; the org Admin's reply moves it to Working and names who you're chatting with.
    expect(await replyChat(deps(), other, t.id, "hi")).toMatchObject({ ok: false });
    expect(await setChatResolved(deps(), other, t.id, true)).toMatchObject({ ok: false });
    expect(await replyChat(deps(), admin, t.id, "Open the team, then Roster.")).toEqual({ ok: true });
    const [working] = (await supportChats(db.pool, coach, "thunder")).mine;
    expect(working).toMatchObject({ status: "working", chattingWith: "Al X · Thunder Basketball Admin" });
    expect(working.messages.map((m) => [m.who, m.helper, m.mine])).toEqual([
      ["Cy X", null, true],
      ["Al X", "Thunder Basketball Admin", false],
    ]);

    // Resolved leaves New and Working; a reply opens it again.
    expect(await setChatResolved(deps(), coach, t.id, true)).toEqual({ ok: true });
    expect((await supportChats(db.pool, admin, "thunder")).inbox![0]).toMatchObject({ status: "resolved", resolvedBy: "Cy X" });
    expect(await replyChat(deps(), coach, t.id, "One more thing")).toEqual({ ok: true });
    expect((await supportChats(db.pool, coach, "thunder")).mine[0]).toMatchObject({ status: "working", resolvedBy: null });
    expect(await setChatResolved(deps(), staff, t.id, true)).toEqual({ ok: true });
    expect(await setChatResolved(deps(), staff, t.id, false)).toEqual({ ok: true });
    expect((await supportChats(db.pool, staff, null)).inbox!.find((c) => c.id === t.id)).toMatchObject({ status: "working" });

    // CourtCaptain Support labels its own replies.
    expect(await replyChat(deps(), staff, p.id, "Check your email.")).toEqual({ ok: true });
    expect((await supportChats(db.pool, other, null)).mine[0].chattingWith).toBe("Sue X · CourtCaptain Support");
  });

  it("a Director of Support answers their organization's chats; another Director doesn't", async () => {
    const t = await askQuestion(deps(), coach, "thunder", "Where are the rosters?");
    if (!t.ok) throw new Error("ask failed");
    await db.pool.query("select set_role('5550004', 'thunder', 'Director', true, 'test')");
    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'thunder', 'teams', 'test')");
    expect((await supportChats(db.pool, other, "thunder")).inbox).toBeNull();
    expect(await replyChat(deps(), other, t.id, "hi")).toMatchObject({ ok: false });

    await db.pool.query("insert into director_areas (coach_id, org, area, granted_by) values ('5550004', 'thunder', 'support', 'test')");
    expect((await supportChats(db.pool, other, "thunder")).inbox!.map((c) => c.id)).toEqual([t.id]);
    expect((await supportChats(db.pool, other, "scenic-city")).inbox).toBeNull();
    expect(await replyChat(deps(), other, t.id, "Open the team, then Roster.")).toEqual({ ok: true });
    expect((await supportChats(db.pool, coach, "thunder")).mine[0].chattingWith).toBe("Oz X · Thunder Basketball Support");
  });

  it("everyone reads questions and guides; staff publish a chat, add, change and remove", async () => {
    const before = (await listArticles(db.pool)).length;
    const t = await askQuestion(deps(), coach, "thunder", "How do I print a roster?");
    if (!t.ok) throw new Error("ask failed");
    expect(await publishChat(deps(), admin, t.id, "How do I print a roster?", "Roster tab.")).toMatchObject({ ok: false });
    expect(await publishChat(deps(), staff, t.id, "How do I print a roster?", "Open the team, then Roster.")).toEqual({
      ok: true,
    });
    const articles = await listArticles(db.pool);
    expect(articles.length).toBe(before + 1);
    const added = articles.find((a) => a.title === "How do I print a roster?")!;
    expect(added).toMatchObject({ kind: "faq", body: "Open the team, then Roster." });

    expect(await saveArticle(deps(), coach, null, { kind: "howto", title: "T", body: "B" })).toMatchObject({ ok: false });
    expect(await saveArticle(deps(), staff, null, { kind: "howto", title: "Print", body: "Step 1\nStep 2" })).toEqual({
      ok: true,
    });
    expect(await saveArticle(deps(), staff, added.id, { kind: "faq", title: "Print a roster?", body: "Roster tab." })).toEqual({
      ok: true,
    });
    expect(await deleteArticle(deps(), staff, added.id)).toEqual({ ok: true });
    expect((await listArticles(db.pool)).length).toBe(before + 1);
  });
});
