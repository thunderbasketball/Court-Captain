import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../auth/service";
import { createTestDb } from "../testing/db";
import { zonedTime } from "../time";
import { bookSlot, limitCheck, releaseSlot } from "./booking";

const person = (coachId: string, first: string, isDirector = false): SessionUser => ({
  coachId,
  firstName: first,
  lastName: "X",
  isDirector,
  isCoach: !isDirector,
  requestPending: false,
  hasThunderRole: true,
});
const director = person("9913694", "Earl", true);
const head = person("5550001", "Hal");
const parent = person("5550002", "Pam");
const otherHead = person("5550003", "Olga");

// Nov 2026. Mon 9, Tue 10, Thu 12, Fri 13; next week Mon 16 ...
const at = (day: number, hour = 18, month = 11) => zonedTime(2026, month, day, hour);

describe("limitCheck", () => {
  const now = at(9, 12); // Mon noon
  it("0 practices: allowed any time that week", () => expect(limitCheck(0, at(13), now)).toEqual({ ok: true }));
  it("1 practice: allowed only within 72 hours", () => {
    expect(limitCheck(1, at(10), now).ok).toBe(true); // Tue 6 PM, 30 h away
    expect(limitCheck(1, at(12, 12), now).ok).toBe(true); // exactly 72 h
    expect(limitCheck(1, at(12, 18), now)).toMatchObject({ ok: false, reason: /within 72 hours/ });
  });
  it("2 practices: refused", () => expect(limitCheck(2, at(10), now)).toMatchObject({ ok: false, reason: /already has 2/ }));
});

describe("booking", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => {
    await db?.drop();
  });

  let now = at(9, 12);
  const deps = () => ({ pool: db.pool, now: () => now });
  let team = "";
  let team2 = "";
  const slot: Record<string, string> = {}; // "court:day:hour[:month]" -> id

  beforeEach(async () => {
    await db.reset();
    now = at(9, 12);
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values
         ('9913694','Earl','X','4239913694'), ('5550001','Hal','X','4235550001'), ('5550002','Pam','X','4235550002'), ('5550003','Olga','X','4235550003')`,
    );
    const t = await db.pool.query<{ id: string }>(
      `insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G A', 'Girls', '{4}', 4, 'REC', 'x'), ('5G B', 'Girls', '{5}', 5, 'REC', 'x') returning id::text`,
    );
    [team, team2] = t.rows.map((r) => r.id);
    await db.pool.query(
      `insert into team_staff (team_id, coach_id, role, added_by) values ($1, '5550001', 'HeadCoach', 'x'), ($1, '5550002', 'TeamParent', 'x'), ($2, '5550003', 'HeadCoach', 'x')`,
      [team, team2],
    );
    const g = await db.pool.query<{ id: string }>("insert into gyms (name) values ('Action Church') returning id::text");
    const c = await db.pool.query<{ id: string; name: string }>(
      "insert into courts (gym_id, name) values ($1, 'North'), ($1, 'South') returning id::text, name",
      [g.rows[0].id],
    );
    // Mon/Tue/Thu/Fri at 6 PM for three weeks on both courts, plus Mon 7 PM.
    const rows: { court: string; name: string; day: number; hour: number }[] = [];
    for (const court of c.rows)
      for (const day of [9, 10, 12, 13, 16, 17, 19, 20, 23, 24, 26, 27])
        for (const hour of day === 9 ? [18, 19] : [18]) rows.push({ court: court.id, name: court.name, day, hour });
    const ins = await db.pool.query<{ id: string }>(
      "insert into slots (court_id, starts_at, created_by) select unnest($1::bigint[]), unnest($2::timestamptz[]), 'x' returning id::text",
      [rows.map((r) => r.court), rows.map((r) => at(r.day, r.hour))],
    );
    rows.forEach((r, i) => (slot[`${r.name}:${r.day}:${r.hour}`] = ins.rows[i].id));
  });

  const book = (who: SessionUser, key: string, everyWeek = false, t = team) =>
    bookSlot(deps(), who, { slotId: slot[key], teamId: t, everyWeek });
  const teamOf = async (key: string) =>
    (await db.pool.query("select team_id::text, booked_by from slots where id = $1", [slot[key]])).rows[0];

  it("a coach books, and Booked By comes from the session", async () => {
    expect(await book(head, "North:13:18")).toMatchObject({ ok: true, booked: [{ slotId: slot["North:13:18"] }], skipped: [] });
    expect(await teamOf("North:13:18")).toEqual({ team_id: team, booked_by: "Hal X" });
  });

  it("the spec's example: Thu booked; Mon within 72 h is allowed; then Tue once Mon is done", async () => {
    // It's the previous Friday; book next Thursday.
    now = zonedTime(2026, 11, 6, 12);
    expect(await book(head, "North:12:18")).toMatchObject({ ok: true });
    // Mon 6 PM is 78 h away: too early for the extra.
    expect(await book(head, "North:9:18")).toMatchObject({ ok: false, message: /within 72 hours/ });
    // Saturday noon: Mon 6 PM is now 54 h away.
    now = zonedTime(2026, 11, 7, 12);
    expect(await book(head, "North:9:18")).toMatchObject({ ok: true });
    // Holding Mon + Thu: no more that week.
    expect(await book(head, "North:10:18")).toMatchObject({ ok: false, message: /already has 2/ });
    // Monday's practice has finished (7:30 PM); Tue 6 PM is within 72 h.
    now = at(9, 19, 11);
    now = new Date(now.getTime() + 30 * 60_000);
    expect(await book(head, "North:10:18")).toMatchObject({ ok: true });
  });

  it("a practice still in progress counts until its hour is over", async () => {
    now = at(9, 17);
    await book(head, "North:9:18");
    await book(head, "North:12:18").then((r) => expect(r.ok).toBe(false)); // Thu is 73 h after Mon 5 PM
    now = at(9, 18, 11);
    now = new Date(now.getTime() + 59 * 60_000); // 6:59 PM, Monday's practice still on
    expect(await book(head, "South:13:18")).toMatchObject({ ok: false });
  });

  it("each week is its own: a booking next week doesn't affect this week", async () => {
    expect(await book(head, "North:13:18")).toMatchObject({ ok: true });
    expect(await book(head, "North:16:18")).toMatchObject({ ok: true });
  });

  it("every future week: books each week it can and reports the rest", async () => {
    await book(otherHead, "North:24:18", false, team2); // taken by another team
    now = zonedTime(2026, 11, 13, 12);
    await book(head, "South:17:18"); // the team already has a practice the week of the 16th (Tue) ...
    now = at(9, 12);
    const r = await book(head, "North:10:18", true); // Tue 6 PM North, every week
    if (!r.ok) throw new Error(r.message);
    expect(r.booked.map((b) => b.slotId)).toEqual([slot["North:10:18"]]);
    expect(r.skipped.map((s) => [s.slotId, s.reason])).toEqual([
      [slot["North:17:18"], expect.stringMatching(/within 72 hours/)],
      [slot["North:24:18"], "Another team already booked it."],
    ]);
  });

  it("can't book a taken, blacked-out, or past slot", async () => {
    await book(otherHead, "North:13:18", false, team2);
    expect(await book(head, "North:13:18")).toEqual({ ok: false, message: "Another team already booked it." });
    await db.pool.query("update slots set blackout = true where id = $1", [slot["North:12:18"]]);
    expect(await book(head, "North:12:18")).toEqual({ ok: false, message: "That time is blacked out." });
    now = at(10, 12);
    expect(await book(head, "North:9:18")).toEqual({ ok: false, message: "That practice time has already started." });
  });

  it("blackouts don't count toward a team's limit", async () => {
    await db.pool.query("update slots set blackout = true where id = $1", [slot["North:10:18"]]);
    expect(await book(head, "North:13:18")).toMatchObject({ ok: true });
  });

  it("the Director is exempt from limits but gets a warning", async () => {
    await book(director, "North:12:18");
    const r = await book(director, "North:13:18");
    expect(r).toMatchObject({ ok: true, booked: [{ slotId: slot["North:13:18"] }] });
    if (r.ok) expect(r.warnings).toHaveLength(1);
  });

  it("from a team's view the Director follows the coach rules", async () => {
    await book(director, "North:12:18");
    expect(await bookSlot(deps(), director, { slotId: slot["North:13:18"], teamId: team, asTeam: true })).toMatchObject({ ok: false, message: /within 72 hours/ });
  });

  it("only the Director and that team's coaches/manager can book", async () => {
    expect(await book(parent, "North:13:18")).toMatchObject({ ok: false, message: /Only a Director of Facilities/ });
    expect(await book(otherHead, "North:13:18")).toMatchObject({ ok: false, message: /Only a Director of Facilities/ });
    expect(await teamOf("North:13:18")).toEqual({ team_id: null, booked_by: null });
  });

  it("two bookings at the same moment can't push a team over the limit", async () => {
    const results = await Promise.all([book(head, "North:12:18"), book(head, "South:13:18"), book(head, "North:13:18")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const n = await db.pool.query("select count(*)::int n from slots where team_id = $1", [team]);
    expect(n.rows[0].n).toBe(1);
  });

  it("two teams grabbing the same slot: only one wins", async () => {
    const [a, b] = await Promise.all([book(head, "North:13:18"), book(otherHead, "North:13:18", false, team2)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("release one week or every future week; only for your own team", async () => {
    await book(head, "North:13:18");
    await book(head, "North:20:18");
    await book(head, "North:27:18");
    expect(await releaseSlot(deps(), otherHead, { slotId: slot["North:13:18"] })).toMatchObject({ ok: false });
    expect(await releaseSlot(deps(), parent, { slotId: slot["North:13:18"] })).toMatchObject({ ok: false });
    expect(await releaseSlot(deps(), head, { slotId: slot["North:20:18"], everyWeek: true })).toEqual({ ok: true, released: 2 });
    expect(await teamOf("North:13:18")).toMatchObject({ team_id: team });
    expect(await teamOf("North:27:18")).toEqual({ team_id: null, booked_by: null });
    expect(await releaseSlot(deps(), director, { slotId: slot["North:13:18"] })).toEqual({ ok: true, released: 1 });
  });

  it("can't release a practice that already started", async () => {
    await book(head, "North:9:18");
    now = at(9, 18);
    expect(await releaseSlot(deps(), head, { slotId: slot["North:9:18"] })).toEqual({
      ok: false,
      message: "That practice has already started.",
    });
  });
});
