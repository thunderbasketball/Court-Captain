import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import type { Mail } from "./email";
import { addPlayers, movePlayer, removePlayer } from "./rosters";
import { createTestDb } from "./testing/db";
import { listUniforms, saveUniform, setNeedsUniform } from "./uniforms";
import { cancelOrder, orderCsv, pastOrders, previewVendorOrder, saveVendor, sendToVendor, vendorView } from "./uniform-vendor";

const person = (coachId: string, firstName: string, isDirector = false, areas?: SessionUser["thunderAreas"]): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector,
  thunderAreas: areas,
  isCoach: true,
  requestPending: false,
  hasThunderRole: true,
});
const earl = person("9913694", "Earl", true); // every area
const teamsOnly = person("5550009", "Tia", true, ["teams"]); // a Director, not of Uniforms
const coach = person("5550001", "Tess");

describe("uniform vendor", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let sent: Mail[] = [];
  let failMail = false;
  let t = new Date("2026-11-20T15:00:00Z");
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const deps = () => ({
    pool: db.pool,
    now: () => t,
    sendMail: async (m: Mail) => {
      if (failMail) throw new Error("mail down");
      sent.push(m);
    },
  });
  const teams: Record<string, string> = {};

  beforeEach(async () => {
    await db.reset();
    sent = [];
    failMail = false;
    t = new Date("2026-11-20T15:00:00Z");
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell, email) values ('9913694', 'Earl', 'X', '4239913694', 'Earl@Me.com')");
    for (const [name, gender, grade] of [
      ["3G Campbell", "Girls", 3],
      ["10B Butcher", "Boys", 10],
    ] as const) {
      teams[name] = (
        await db.pool.query<{ id: string }>(
          `insert into teams (name, gender, grades, grade_sort, level, created_by) values ($1, $2, $3, $4, 'REC', 'x') returning id::text`,
          [name, gender, [grade], grade],
        )
      ).rows[0].id;
    }
    // Ordered at registration: Rogers #2 YS, Kimsey #0 YM, Matthews (no size yet) on 3G; Dawson #12 AS, Ogle #1 AM on 10B;
    // Lee on 10B didn't order.
    const players = [
      ["g1", "Ava", "Rogers", "Girls", "3", true, "3G Campbell", "2", "YS"],
      ["g2", "Bea", "Kimsey", "Girls", "3", true, "3G Campbell", "0", "YM"],
      ["g3", "Cy", "Matthews", "Girls", "3", true, "3G Campbell", "5", null],
      ["b1", "Dan", "Dawson", "Boys", "10", true, "10B Butcher", "12", "AS"],
      ["b2", "Eli", "Ogle", "Boys", "10", true, "10B Butcher", "1", "AM"],
      ["b3", "Finn", "Lee", "Boys", "10", false, "10B Butcher", "7", null],
    ] as const;
    for (const [id, first, last, gender, grade, needed, team, number, size] of players) {
      await db.pool.query(
        `insert into registrations (registrant_id, registration_id, first_name, last_name, gender, grade, grade_sort, program, raw,
                                    imported_at, imported_by, uniform_needed)
         values ($1, $1, $2, $3, $4, $5, $6, 'x', '{}', now(), 'x', $7)`,
        [id, first, last, gender, grade, Number(grade), needed],
      );
      await addPlayers(deps(), earl, teams[team], [id]);
      await saveUniform(deps(), earl, teams[team], id, { number, ...(size ? { size } : {}) });
    }
  });

  it("only Directors of Uniforms set the vendor; emails are checked, Cc de-duplicated", async () => {
    expect(await saveVendor(deps(), coach, "a@b.com", "")).toMatchObject({ ok: false });
    expect(await saveVendor(deps(), teamsOnly, "a@b.com", "")).toMatchObject({ ok: false });
    expect(await vendorView(deps(), teamsOnly)).toBeNull();
    expect(await saveVendor(deps(), earl, "not an email", "")).toEqual({ ok: false, message: "Enter the vendor's email address." });
    expect(await saveVendor(deps(), earl, "Orders@Vendor.com", "x@y.com, bad")).toEqual({ ok: false, message: '"bad" isn\'t an email address.' });
    expect(await saveVendor(deps(), earl, "Orders@Vendor.com", "x@y.com\nX@y.com; orders@vendor.com\nz@y.com")).toEqual({ ok: true });
    expect(await vendorView(deps(), earl)).toMatchObject({ email: "orders@vendor.com", cc: ["x@y.com", "z@y.com"], setBy: "Earl X" });
  });

  it("holds back a player missing a size; needs the vendor's email to send", async () => {
    const v = (await vendorView(deps(), earl))!;
    expect(v.ready.map((r) => r.name)).toEqual(["KIMSEY", "ROGERS", "OGLE", "DAWSON"]); // GIRLS then BOYS, by number
    expect(v.held).toEqual([expect.objectContaining({ name: "MATTHEWS", missing: "no size" })]);
    expect(await sendToVendor(deps(), earl, false)).toEqual({ ok: false, message: "Set the vendor's email first (the gear on this card)." });
    expect(await sendToVendor(deps(), coach, false)).toMatchObject({ ok: false });
  });

  it("a duplicate number is blocked from the order until it's changed, even from Send everyone", async () => {
    await saveVendor(deps(), earl, "orders@vendor.com", "");
    await saveUniform(deps(), earl, teams["10B Butcher"], "b2", { number: "12" }); // Dawson's
    const v = (await vendorView(deps(), earl))!;
    expect(v.ready.map((r) => r.name)).toEqual(["KIMSEY", "ROGERS"]);
    expect(v.held.map((h) => [h.name, h.missing]).sort()).toEqual([
      ["DAWSON", "duplicate number #12"],
      ["MATTHEWS", "no size"],
      ["OGLE", "duplicate number #12"],
    ]);
    expect(await sendToVendor(deps(), earl, true)).toMatchObject({ ok: true, players: 2 });
    expect(sent[0].text).not.toContain("DAWSON");
    await saveUniform(deps(), earl, teams["10B Butcher"], "b2", { number: "1" });
    expect(await sendToVendor(deps(), earl, false)).toMatchObject({ ok: true, players: 2 });
    expect(sent[1].text).toContain("DAWSON  #12");
  });

  it("emails the new players with the order number; the next send has only new ones", async () => {
    await saveVendor(deps(), earl, "orders@vendor.com", "earl@thunder.org");
    expect(await sendToVendor(deps(), earl, false)).toMatchObject({ ok: true, players: 4, orderNo: "20261120" });
    expect(sent[0]).toMatchObject({ to: "orders@vendor.com", cc: ["earl@thunder.org", "earl@me.com"], subject: "Thunder Basketball uniform order #20261120: 4 players" });
    expect(sent[0].text).toContain("GIRLS\n3G Campbell  KIMSEY  #0  YM\n3G Campbell  ROGERS  #2  YS\n\nBOYS\n10B Butcher  OGLE  #1  AM");
    expect(sent[0].attachments?.[0]).toMatchObject({ filename: "Thunder uniform order 20261120.csv", contentType: "text/csv" });

    expect(await sendToVendor(deps(), earl, false)).toEqual({ ok: false, message: "No new uniforms to send." });
    await saveUniform(deps(), earl, teams["3G Campbell"], "g3", { size: "YS" }); // Matthews now complete
    expect(await sendToVendor(deps(), earl, false)).toMatchObject({ ok: true, players: 1, orderNo: "20261120-2" }); // same day
    t = new Date("2026-11-21T15:00:00Z");
    expect(await sendToVendor(deps(), earl, true)).toMatchObject({ ok: true, players: 5, orderNo: "20261121" }); // Send everyone

    const past = (await pastOrders(deps(), earl))!;
    expect(past.map((o) => [o.orderNo, o.players.length, o.everyone])).toEqual([
      ["20261121", 5, true],
      ["20261120-2", 1, false],
      ["20261120", 4, false],
    ]);
    expect(past[1].players[0]).toMatchObject({ team: "3G Campbell", name: "MATTHEWS", number: "5", size: "YS" });
    expect((await vendorView(deps(), earl))?.last).toMatchObject({ orderNo: "20261121", counts: "5 players", sentBy: "Earl X" });
  });

  it("the preview is the email Send sends, with the sender copied; nothing is sent or recorded", async () => {
    await saveVendor(deps(), earl, "orders@vendor.com", "coach@thunder.org");
    const p = await previewVendorOrder(deps(), earl, false);
    expect(p).toMatchObject({
      ok: true,
      draft: {
        to: "orders@vendor.com",
        cc: ["coach@thunder.org", "earl@me.com"],
        senderCopied: true,
        orderNo: "20261120",
        subject: "Thunder Basketball uniform order #20261120: 4 players",
        filename: "Thunder uniform order 20261120.csv",
        players: 4,
      },
    });
    expect(sent).toHaveLength(0);
    expect(await pastOrders(deps(), earl)).toEqual([]);
    await sendToVendor(deps(), earl, false);
    if (!p.ok) throw new Error("no preview");
    expect(sent[0]).toMatchObject({ to: p.draft.to, cc: p.draft.cc, subject: p.draft.subject, text: p.draft.text });
    expect(await previewVendorOrder(deps(), coach, false)).toMatchObject({ ok: false });
  });

  it("a sender with no email on file isn't copied (the preview says so)", async () => {
    await db.pool.query("update users set email = null where coach_id = '9913694'");
    await saveVendor(deps(), earl, "orders@vendor.com", "");
    expect(await previewVendorOrder(deps(), earl, false)).toMatchObject({ ok: true, draft: { cc: [], senderCopied: false } });
  });

  it("cancel the newest order: its players are new again, the vendor is told, the next order gets a new number", async () => {
    await saveVendor(deps(), earl, "orders@vendor.com", "coach@thunder.org");
    await sendToVendor(deps(), earl, false); // #20261120, 4 players
    expect(await cancelOrder(deps(), coach, "20261120", true)).toMatchObject({ ok: false });
    expect(await cancelOrder(deps(), earl, "20991231", true)).toEqual({ ok: false, message: "Only the newest order can be cancelled." });
    sent = [];
    expect(await cancelOrder(deps(), earl, "20261120", true)).toEqual({ ok: true });
    expect(sent[0]).toMatchObject({
      to: "orders@vendor.com",
      cc: ["coach@thunder.org", "earl@me.com"],
      subject: "CANCELLED: Thunder Basketball uniform order #20261120",
    });
    const v = (await vendorView(deps(), earl))!;
    expect([v.ready.length, v.sentPlayers, v.last]).toEqual([4, 0, null]);
    expect((await pastOrders(deps(), earl))![0]).toMatchObject({ orderNo: "20261120", cancelled: { by: "Earl X" }, canCancel: false });
    expect(await cancelOrder(deps(), earl, "20261120", false)).toMatchObject({ ok: false }); // already cancelled

    sent = [];
    expect(await sendToVendor(deps(), earl, false)).toMatchObject({ ok: true, players: 4, orderNo: "20261120-2" });
    expect((await pastOrders(deps(), earl))!.map((o) => [o.orderNo, !!o.cancelled, o.canCancel])).toEqual([
      ["20261120-2", false, true],
      ["20261120", true, false],
    ]);
    // Without telling the vendor: nothing emailed.
    sent = [];
    expect(await cancelOrder(deps(), earl, "20261120-2", false)).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("if the cancel email fails, the order stays", async () => {
    await saveVendor(deps(), earl, "orders@vendor.com", "");
    await sendToVendor(deps(), earl, false);
    failMail = true;
    await expect(cancelOrder(deps(), earl, "20261120", true)).rejects.toThrow("mail down");
    expect((await pastOrders(deps(), earl))![0]).toMatchObject({ cancelled: null, canCancel: true });
  });

  it("if the email fails, nothing is recorded", async () => {
    await saveVendor(deps(), earl, "orders@vendor.com", "");
    failMail = true;
    await expect(sendToVendor(deps(), earl, false)).rejects.toThrow("mail down");
    expect(await pastOrders(deps(), earl)).toEqual([]);
    expect((await vendorView(deps(), earl))?.ready).toHaveLength(4);
  });

  it("the spreadsheet: order number, GIRLS then BOYS, a blank row between teams, never a formula", () => {
    const row = (team: string, gender: string, name: string, number: string) => ({ teamId: team, team, gender, registrantId: name, name, number, size: "YM" });
    const csv = orderCsv(
      [row("3G A", "Girls", "ROGERS", "2"), row("4G B", "Girls", "=HYPERLINK(1)", "3"), row("9B C", "Boys", "SMITH, JR", "4")],
      "20261120",
    );
    expect(csv.split("\r\n")).toEqual([
      "Thunder Basketball uniform order #20261120",
      "",
      "Team,Last name,Number,Size",
      "",
      "GIRLS",
      "3G A,ROGERS,2,YM",
      "",
      "4G B,'=HYPERLINK(1),3,YM",
      "",
      "BOYS",
      '9B C,"SMITH, JR",4,YM',
      "",
    ]);
  });

  it("an order follows the player to a new team: not ordered again, number and size come along; a 2nd team, a real change or a new uniform still counts", async () => {
    const other = (
      await db.pool.query<{ id: string }>("insert into teams (name, gender, grades, grade_sort, level, created_by) values ('4G Epps', 'Girls', '{4}', 4, 'COMP', 'x') returning id::text")
    ).rows[0].id;
    const here = teams["3G Campbell"];
    const ready = async () => (await vendorView(deps(), earl))!.ready.map((r) => `${r.team} ${r.name}`);
    const mine = async (team: string, id: string) => (await listUniforms(deps(), earl, team))?.find((r) => r.registrantId === id);
    expect(await saveVendor(deps(), earl, "v@example.com", "")).toMatchObject({ ok: true });
    expect(await sendToVendor(deps(), earl, false)).toMatchObject({ ok: true, players: 4 });
    expect(await ready()).toEqual([]);

    // Moved straight to another team.
    expect(await movePlayer(deps(), earl, "g1", other)).toEqual({ ok: true });
    expect(await ready()).toEqual([]);
    expect(await mine(other, "g1")).toMatchObject({ number: "2", size: "YS", orderNo: "20261120", locked: true });
    expect(await mine(here, "g1")).toBeUndefined();
    expect((await vendorView(deps(), earl))!.sentPlayers).toBe(4);

    // Taken off, then put on another team later (and from the roster board's Not on a team).
    expect(await removePlayer(deps(), earl, here, "g2")).toEqual({ ok: true });
    expect(await addPlayers(deps(), earl, other, ["g2"])).toMatchObject({ ok: true });
    expect(await mine(other, "g2")).toMatchObject({ number: "0", size: "YM", orderNo: "20261120" });
    expect(await movePlayer(deps(), earl, "g2", null)).toEqual({ ok: true });
    expect(await movePlayer(deps(), earl, "g2", here, null)).toEqual({ ok: true });
    expect(await mine(here, "g2")).toMatchObject({ number: "0", size: "YM", orderNo: "20261120" });
    expect(await ready()).toEqual([]);

    // Not ordered yet: their number, size and Needs a uniform move too, and they're ordered once, on the new team.
    await movePlayer(deps(), earl, "g3", other);
    expect(await mine(other, "g3")).toMatchObject({ number: "5", size: null });
    await setNeedsUniform(deps(), earl, teams["10B Butcher"], "b3", true);
    await saveUniform(deps(), earl, teams["10B Butcher"], "b3", { size: "AL" });
    await movePlayer(deps(), earl, "b3", other);
    expect(await mine(other, "b3")).toMatchObject({ number: "7", size: "AL", ordered: true });
    expect(await ready()).toEqual(["4G Epps LEE"]);

    // Needs a new one after moving: in the next order, once.
    t = new Date("2026-11-21T15:00:00Z");
    expect(await setNeedsUniform(deps(), earl, other, "g1", true)).toMatchObject({ ok: true });
    expect(await ready()).toContain("4G Epps ROGERS");
    expect(await setNeedsUniform(deps(), earl, other, "g1", false)).toMatchObject({ ok: true });
    expect(await ready()).not.toContain("4G Epps ROGERS");

    // On a 2nd team while still on the first: each team has its own, as before.
    expect(await addPlayers(deps(), earl, here, ["g1"], true)).toMatchObject({ ok: true });
    expect(await mine(here, "g1")).toMatchObject({ number: "2", size: "YS" }); // ordered for 3G Campbell itself
    expect(await addPlayers(deps(), earl, other, ["b1"], true)).toMatchObject({ ok: true });
    expect(await mine(other, "b1")).toMatchObject({ number: null, orderNo: null });
    // A cancelled order doesn't follow anyone.
    expect(await cancelOrder(deps(), earl, "20261120", false)).toEqual({ ok: true });
    expect((await mine(other, "g1"))?.orderNo).toBeNull();
  });
});
