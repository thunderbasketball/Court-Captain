import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import type { Mail } from "./email";
import { checkSpares, spareCount, spareSummary } from "./spare-items";
import { addSpares, pendingSpares, removeSpare } from "./uniform-spares";
import { cancelOrder, orderCsv, pastOrders, previewVendorOrder, saveVendor, sendToVendor, vendorView } from "./uniform-vendor";
import { createTestDb } from "./testing/db";

const person = (coachId: string, firstName: string, isDirector = false, areas?: SessionUser["thunderAreas"]) =>
  ({ coachId, firstName, lastName: "X", isDirector, thunderAreas: areas, isCoach: true, requestPending: false, hasThunderRole: true }) as SessionUser;
const earl = person("9913694", "Earl", true);
const teamsOnly = person("5550009", "Tia", true, ["teams"]);
const mix = [
  { item: "shorts", size: "AL", qty: 2 },
  { item: "shorts", size: "YS", qty: 3 },
  { item: "shirt", number: "10", size: "YM" },
  { item: "set", number: "07", size: "YS" },
  { item: "set", number: "00", size: "AM" },
  { item: "jersey", number: "4", size: "YL" },
];

describe("spares", () => {
  it("numbers and sizes are checked, put in order; shorts are counted by size", () => {
    const c = checkSpares(mix);
    if (!c.ok) throw new Error(c.message);
    expect(c.rows.map((r) => `${r.item} ${r.number ?? "-"} ${r.size} ${r.qty}`)).toEqual(["set 00 AM 1", "set 7 YS 1", "jersey 4 YL 1", "shirt 10 YM 1", "shorts - YS 3", "shorts - AL 2"]);
    expect(spareCount(c.rows)).toBe(9);
    expect(spareSummary(c.rows)).toBe("2 uniform sets, 1 jersey, 1 shooting shirt, 5 shorts");
    for (const bad of [
      [],
      null,
      [{ item: "hat", size: "YS" }],
      [{ item: "set", number: "", size: "YS" }],
      [{ item: "set", number: "100", size: "YS" }],
      [{ item: "set", number: "=1", size: "YS" }],
      [{ item: "jersey", number: "4", size: "XXL" }],
      [{ item: "shorts", size: "YS", qty: 0 }],
      [{ item: "shorts", size: "YS", qty: 2.5 }],
      [{ item: "shorts", size: "YS", qty: 999 }],
      [{ item: "shorts", size: "YS", qty: 1 }, { item: "shorts", size: "YS", qty: 1 }],
      Array.from({ length: 61 }, () => ({ item: "shirt", number: "1", size: "YS" })),
    ])
      expect(checkSpares(bad).ok, JSON.stringify(bad)?.slice(0, 60)).toBe(false);
    const csv = orderCsv([], "20261125", c.rows);
    expect(csv).toContain("SPARES\r\nItem,,Number,Size\r\nUniform set,,00,AM\r\n");
    expect(csv).toContain("SPARE SHORTS\r\nSize,Quantity\r\nYS,3\r\nAL,2\r\n"); // no number
    expect(orderCsv([], "20261125", c.rows.filter((r) => r.item === "shorts"))).not.toContain("Number");
  });

  let db: Awaited<ReturnType<typeof createTestDb>>;
  let sent: Mail[] = [];
  let fail = false;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  beforeEach(async () => {
    await db.reset();
    sent = [];
    fail = false;
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell, email) values ('9913694', 'Earl', 'X', '4239913694', 'earl@me.com')");
  });
  const deps = () => ({
    pool: db.pool,
    now: () => new Date("2026-11-25T15:00:00Z"),
    sendMail: async (m: Mail) => {
      if (fail) throw new Error("mail down");
      sent.push(m);
    },
  });

  it("Directors of Uniforms add them to the next order and take them off; shorts of a size add up", async () => {
    expect(await addSpares(deps(), teamsOnly, mix)).toMatchObject({ ok: false });
    expect(await addSpares(deps(), { ...earl, actingBy: "x" } as unknown as SessionUser, mix)).toMatchObject({ ok: false });
    expect(await addSpares(deps(), earl, [])).toMatchObject({ ok: false });
    expect(await addSpares(deps(), earl, mix)).toEqual({ ok: true, added: 9, waiting: 9 });
    expect(await addSpares(deps(), earl, [{ item: "shorts", size: "YS", qty: 4 }])).toEqual({ ok: true, added: 4, waiting: 13 });
    expect(await addSpares(deps(), earl, [{ item: "shorts", size: "YS", qty: 200 }])).toMatchObject({ ok: false });
    expect(await addSpares(deps(), earl, Array.from({ length: 59 }, () => ({ item: "set", number: "1", size: "YS" })))).toMatchObject({ ok: false });
    const list = await pendingSpares(db.pool);
    expect(list.map((r) => `${r.item} ${r.number ?? "-"} ${r.size} ${r.qty}`)).toEqual(["set 00 AM 1", "set 7 YS 1", "jersey 4 YL 1", "shirt 10 YM 1", "shorts - YS 7", "shorts - AL 2"]);
    expect(list[0].addedBy).toBe("Earl X");
    expect(await removeSpare(deps(), teamsOnly, list[0].id)).toMatchObject({ ok: false });
    expect(await removeSpare(deps(), earl, "x")).toMatchObject({ ok: false });
    expect(await removeSpare(deps(), earl, list[0].id)).toEqual({ ok: true });
    expect(await removeSpare(deps(), earl, list[0].id)).toMatchObject({ ok: false });
    expect(await pendingSpares(db.pool)).toHaveLength(5);
  }, 60_000);

  it("they go with the next order (alone if no players are new), once; cancelled, they wait again", async () => {
    await addSpares(deps(), earl, mix);
    expect(await sendToVendor(deps(), earl, false)).toMatchObject({ ok: false }); // no vendor yet
    await saveVendor(deps(), earl, "v@example.com", "cc@example.com");
    expect((await vendorView(deps(), earl))!.spares).toHaveLength(6);
    const p = await previewVendorOrder(deps(), earl, false);
    if (!p.ok) throw new Error(p.message);
    expect(p.draft).toMatchObject({ to: "v@example.com", orderNo: "20261125", subject: "Thunder Basketball uniform order #20261125: 9 spares" });
    expect(p.draft.text).toContain("SPARE UNIFORM SETS (2): jersey and shorts\n#00  AM\n#7  YS");
    expect(p.draft.text).toContain("SPARE SHORTS (5)\nYS  x 3\nAL  x 2");
    expect(sent).toEqual([]);
    fail = true;
    await expect(sendToVendor(deps(), earl, false)).rejects.toThrow();
    expect([(await pastOrders(deps(), earl))!.length, (await pendingSpares(db.pool)).length]).toEqual([0, 6]);
    fail = false;

    // With a new player too.
    await db.pool.query("insert into teams (name, gender, grades, grade_sort, level, created_by) values ('3G Lee', 'Girls', '{3}', 3, 'REC', 'x')");
    await db.pool.query(
      `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw, imported_at, imported_by, uniform_needed)
       values ('g1', 'g1', 'Ava', 'Rogers', 'Girls', '3', 3, 'x', '{}', now(), 'x', true)`,
    );
    await db.pool.query("insert into team_players (team_id, registrant_id, first_name, last_name, gender, grade, grade_sort, rostered_by, rostered_at) select id, 'g1', 'Ava', 'Rogers', 'Girls', '3', 3, 'x', now() from teams");
    await db.pool.query("insert into team_uniforms (team_id, registrant_id, number, size, updated_by, updated_at) select id, 'g1', '2', 'YS', 'x', now() from teams");
    expect(await sendToVendor(deps(), earl, false)).toEqual({ ok: true, players: 1, orderNo: "20261125", counts: "1 player and 9 spares" });
    expect(sent[0].subject).toBe("Thunder Basketball uniform order #20261125: 1 player and 9 spares");
    expect(sent[0].text).toContain("3G Lee  ROGERS  #2  YS");
    expect(sent[0].text).toContain("SPARE JERSEYS (1)\n#4  YL");
    expect(sent).toHaveLength(1);
    expect(await sendToVendor(deps(), earl, false)).toMatchObject({ ok: false }); // nothing left to send
    expect((await vendorView(deps(), earl))!.last).toMatchObject({ orderNo: "20261125", counts: "1 player and 9 spares" });
    expect((await pastOrders(deps(), earl))!.map((o) => [o.orderNo, o.players.length, o.spares.length])).toEqual([["20261125", 1, 6]]);

    // Cancelled: the player and the spares wait again (shorts join what's already waiting); the order keeps its list.
    await addSpares(deps(), earl, [{ item: "shorts", size: "YS", qty: 1 }]);
    expect(await cancelOrder(deps(), earl, "20261125", true)).toEqual({ ok: true });
    expect(sent.at(-1)?.text).toContain("uniform order #20261125 (1 player and 9 spares)");
    expect((await pendingSpares(db.pool)).map((r) => `${r.item} ${r.size} ${r.qty}`)).toEqual(["set AM 1", "set YS 1", "jersey YL 1", "shirt YM 1", "shorts YS 4", "shorts AL 2"]);
    expect((await pastOrders(deps(), earl))![0].spares).toHaveLength(6);
    expect(await sendToVendor(deps(), earl, false)).toMatchObject({ ok: true, orderNo: "20261125-2", counts: "1 player and 10 spares" });
    // Spares alone.
    await addSpares(deps(), earl, [{ item: "shorts", size: "YM", qty: 4 }]);
    expect(await sendToVendor(deps(), earl, false)).toMatchObject({ ok: true, players: 0, counts: "4 spares" });
    expect(sent.at(-1)!.text).not.toContain("names");
    expect((await vendorView(deps(), earl))!.last).toMatchObject({ counts: "4 spares" });
  }, 90_000);
});
