import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../auth/service";
import { createTestDb } from "../testing/db";
import { zonedTime } from "../time";
import { addGym, addSlots, blackoutDates, deleteBlackoutRule, setSlotBlocked } from "./admin";
import { describeRule, listBlackouts, repeatOptions, ruleStart } from "./rules";

const day = (d: Date | null) => d?.toISOString().slice(0, 10);

describe("yearly rule dates", () => {
  it("finds fixed dates, nth weekdays and last weekdays", () => {
    const thanksgiving = { kind: "nth" as const, month: 11, nth: 4, weekday: 4, spanDays: 2 };
    expect(day(ruleStart(thanksgiving, 2026))).toBe("2026-11-26");
    expect(day(ruleStart(thanksgiving, 2027))).toBe("2027-11-25");
    expect(day(ruleStart({ kind: "nth", month: 1, nth: 3, weekday: 1, spanDays: 1 }, 2027))).toBe("2027-01-18"); // MLK Day
    expect(day(ruleStart({ kind: "last", month: 5, weekday: 1, spanDays: 1 }, 2027))).toBe("2027-05-31"); // Memorial Day
    expect(day(ruleStart({ kind: "date", month: 12, day: 24, spanDays: 2 }, 2027))).toBe("2027-12-24");
    expect(ruleStart({ kind: "date", month: 2, day: 29, spanDays: 1 }, 2027)).toBeNull();
  });

  it("offers the repeat choices that fit the chosen date", () => {
    expect(repeatOptions("2026-11-26", 2).map((o) => o.label)).toEqual([
      "Every year on Nov 26 + 1 day after",
      "Every year on the 4th Thursday of November + 1 day after",
      "Every year on the last Thursday of November + 1 day after",
    ]);
    expect(repeatOptions("2026-12-24", 1).map((o) => o.kind)).toEqual(["date", "nth"]);
    expect(describeRule({ kind: "date", month: 7, day: 4, spanDays: 1 })).toBe("Every year on Jul 4");
  });
});

describe("yearly blackouts and single-slot block", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => {
    await db?.drop();
  });
  const director: SessionUser = {
    coachId: "9913694",
    firstName: "Earl",
    lastName: "Epps",
    isDirector: true,
    isCoach: false,
    requestPending: false,
    hasThunderRole: true,
  };
  const now = zonedTime(2026, 10, 28, 12);
  const deps = () => ({ pool: db.pool, now: () => now });
  let gym = "";

  beforeEach(async () => {
    await db.reset();
    const g = await addGym(deps(), director, { name: "Action Church", courts: ["North"] });
    if (!g.ok) throw new Error("setup");
    gym = g.id;
    // Thursdays and Fridays at 6 PM, Nov 2026 and Nov 2027.
    await addSlots(deps(), director, { gymId: gym, courtId: "all", from: "2026-11-23", to: "2026-11-28", days: [4, 5], hours: [18] });
    await addSlots(deps(), director, { gymId: gym, courtId: "all", from: "2027-11-22", to: "2027-11-27", days: [4, 5], hours: [18] });
  });

  const blocked = async () =>
    (
      await db.pool.query(
        "select to_char(starts_at at time zone 'America/New_York', 'YYYY-MM-DD') as d, blackout, note from slots order by starts_at",
      )
    ).rows;

  it("Thanksgiving as the 4th Thursday + 1 day blocks this year and next, and slots added later", async () => {
    const r = await blackoutDates(deps(), director, {
      mode: "block",
      gymId: "all",
      from: "2026-11-26",
      to: "2026-11-27",
      hour: "all",
      reason: "Thanksgiving",
      repeat: "nth",
    });
    expect(r).toMatchObject({ ok: true, slots: 4, rule: "Every year on the 4th Thursday of November + 1 day after" });
    expect(await blocked()).toEqual([
      { d: "2026-11-26", blackout: true, note: "Thanksgiving" },
      { d: "2026-11-27", blackout: true, note: "Thanksgiving" },
      { d: "2027-11-25", blackout: true, note: "Thanksgiving" },
      { d: "2027-11-26", blackout: true, note: "Thanksgiving" },
    ]);
    // Three years out, slots added later come in blocked on the right dates (2029: Nov 22–23).
    const added = await addSlots(deps(), director, {
      gymId: gym,
      courtId: "all",
      from: "2029-11-19",
      to: "2029-11-24",
      days: [4, 5],
      hours: [18],
    });
    expect(added).toMatchObject({ added: 2, blocked: 2 });
    const list = await listBlackouts(db.pool, now);
    expect(list.rules.map((x) => x.label)).toEqual(["Every year on the 4th Thursday of November + 1 day after"]);
    expect(list.upcoming.slice(0, 2).map((b) => [b.day, b.reason])).toEqual([
      ["2026-11-26", "Thanksgiving"],
      ["2026-11-27", "Thanksgiving"],
    ]);
  });

  it("deleting a yearly blackout reopens its upcoming slots", async () => {
    await blackoutDates(deps(), director, {
      mode: "block",
      gymId: "all",
      from: "2026-11-26",
      to: "2026-11-27",
      hour: "all",
      reason: "Thanksgiving",
      repeat: "nth",
    });
    const rule = (await listBlackouts(db.pool, now)).rules[0];
    expect(await deleteBlackoutRule(deps(), director, rule.id)).toEqual({ ok: true, reopened: 4 });
    expect((await blocked()).every((s) => !s.blackout)).toBe(true);
    expect((await listBlackouts(db.pool, now)).upcoming).toEqual([]);
  });

  it("Block / Unblock one slot; blocking removes its booking", async () => {
    const t = await db.pool.query<{ id: string }>(
      "insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Epps', 'Girls', '{4}', 4, 'REC', 'x') returning id::text",
    );
    const s = await db.pool.query<{ id: string }>("select id::text from slots order by starts_at limit 1");
    await db.pool.query("update slots set team_id = $1 where id = $2", [t.rows[0].id, s.rows[0].id]);
    expect(await setSlotBlocked(deps(), director, { slotId: s.rows[0].id, blocked: true })).toEqual({ ok: true, removed: "4G Epps" });
    expect((await blocked())[0]).toMatchObject({ blackout: true });
    expect(await setSlotBlocked(deps(), director, { slotId: s.rows[0].id, blocked: false })).toEqual({ ok: true, removed: null });
    expect((await blocked())[0]).toMatchObject({ blackout: false });
    const coach = { ...director, isDirector: false };
    expect(await setSlotBlocked(deps(), coach, { slotId: s.rows[0].id, blocked: true })).toMatchObject({ ok: false });
  });
});
