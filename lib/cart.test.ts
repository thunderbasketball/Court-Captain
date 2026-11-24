import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth/service";
import { addManyToCart, addToCart, getCart, inCarts, payCart, programCarts, registerPayLater, removeFromCart } from "./cart";
import { cancelRequested, markRequestedPaid, payRequested, pendingInvoices, requestInvoice, requestedInvoice, requestedInvoiceEmail } from "./cart-invoices";
import { buildInvoice, pastDueInvoices } from "./invoices";
import { registerAllOrgTeams, registerOrgTeam, teamPrograms } from "./org-leagues";
import { createOrganization } from "./org-signup";
import { createOrgTeam, removeOrgTeamCoach } from "./org-teams";
import { addDivision, savePriceGroup, saveProgram, saveProgramDates, tagOrgs, programPriceGroups } from "./scenic-programs";
import type { StripeApi } from "./stripe/connect";
import { confirmPayment, insertPayment, openCheckout, registerOrPay, type PayTeam } from "./stripe/registration";
import { createTestDb, grant } from "./testing/db";

const person = (coachId: string, firstName: string): SessionUser =>
  ({ coachId, firstName, lastName: "X", isDirector: false, isCoach: false, requestPending: false, hasThunderRole: false }) as SessionUser;
const jo = person("5550001", "Jo"); // Owner
const ann = person("5550002", "Ann"); // Admin
const cam = person("5550003", "Cam"); // coaches one COMP team
const nat = person("5550004", "Nat"); // nobody
const dee = person("9913694", "Dee"); // Scenic City Admin
const org = "east-ridge-parks-and-rec";
const BASE = "https://app.test";
const ALL = { allSeason: true, days: [] };
const day = (...d: string[]) => ({ allSeason: false, days: d.map((date) => ({ date, kind: "single_1" })) });

function fakeStripe() {
  const checkouts: { id: string; lines: { name: string; cents: number }[] }[] = [];
  const paid = new Set<string>();
  const api = {
    live: false,
    createCheckout: async (p: { ref: string; lines: { name: string; cents: number }[]; embedded?: boolean }) => {
      const id = `cs_test_${p.ref}`;
      checkouts.push({ id, lines: p.lines });
      return p.embedded ? { id, url: "", clientSecret: `${id}_secret` } : { id, url: `https://checkout.stripe.test/${id}` };
    },
    checkoutPaid: async ({ id }: { id: string }) => paid.has(id),
  } as unknown as StripeApi;
  return { api, checkouts, paid };
}

describe("the shopping cart", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 180_000);
  afterAll(async () => db?.drop());
  const now = new Date("2026-11-24T15:00:00Z");
  let pid = "";
  let s = fakeStripe();
  const deps = () => ({ pool: db.pool, stripe: s.api, now: () => now });
  const team = async (grade = "4") => ((await createOrgTeam(deps(), jo, org, { gender: "Boys", grades: [grade], level: "COMP" })) as { id: string }).id;
  const regOf = async (tid: string) => (await teamPrograms(deps(), jo, org, tid))!.programs[0].registered;
  const cart = (who: SessionUser) => getCart(deps(), who, org);
  const add = (who: SessionUser, tid: string, choice: unknown) => addToCart(deps(), who, pid, { org, orgTeamId: tid }, choice);

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from org_stripe");
    s = fakeStripe();
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jo', 'X', '4235550001'), ('5550002', 'Ann', 'X', '4235550002'),
         ('5550003', 'Cam', 'X', '4235550003'), ('5550004', 'Nat', 'X', '4235550004'), ('9913694', 'Dee', 'X', '4239913694')`,
    );
    await grant(db.pool, "9913694 scenic-city Director", "9913694 scenic-city Admin");
    await createOrganization(deps(), jo, { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e", features: ["court-club"] }, null);
    await grant(db.pool, `5550002 ${org} Admin`);
    await db.pool.query("insert into org_stripe (org, livemode, account_id, connected_by, charges_enabled) values ('scenic-city', false, 'acct_league', 'Dee X', true)");
    pid = (
      (await saveProgram(deps(), dee, null, {
        kind: "League",
        name: "Winter",
        startsOn: "2026-12-05",
        endsOn: "2027-02-28",
        regOpens: "2026-10-01",
        regCloses: "2027-01-31",
        fee: "",
        options: [
          { kind: "all_season", fee: "250" },
          { kind: "single_1", fee: "35" },
          { kind: "single_2nd", fee: "20" },
        ],
      })) as { id: string }
    ).id;
    await saveProgramDates(deps(), dee, pid, { add: ["2026-12-05", "2026-12-12", "2026-12-19"], addBrackets: [], remove: [] });
    await addDivision(deps(), dee, pid, { gender: "Boys", from: 3, to: 4, levels: ["COMP"] });
  });

  it("several teams, each its own way, paid together: nothing is registered until Stripe says it's paid", async () => {
    const [a, b] = [await team(), await team("3")];
    expect(await add(nat, a, ALL)).toMatchObject({ ok: false }); // nobody
    expect(await add(jo, a, { allSeason: "x", days: "y" })).toMatchObject({ ok: false });
    expect(await add(jo, a, day("2026-12-25"))).toMatchObject({ ok: false }); // not a Game Day
    expect(await add(jo, a, { allSeason: false, days: [] })).toMatchObject({ ok: false }); // nothing picked
    expect(await add(jo, a, ALL)).toEqual({ ok: true, replaced: false });
    expect(await add(jo, b, day("2026-12-05"))).toEqual({ ok: true, replaced: false });
    expect(await add(jo, b, day("2026-12-05", "2026-12-12"))).toEqual({ ok: true, replaced: true }); // picked again
    const c = await cart(jo);
    expect(c.count).toBe(2);
    expect(c.groups).toHaveLength(1);
    expect(c.groups[0]).toMatchObject({ org, programId: pid, cents: 25000 + 7000, payLater: false });
    expect(c.groups[0].lines.map((l) => [l.what, l.cents, l.problem]).sort()).toEqual([
      ["ALL Season", 25000, null],
      ["Dec 5 1 game · Dec 12 1 game", 7000, null],
    ]);
    // Their own: Ann's is empty, and she can't take out or pay for Jo's.
    expect((await cart(ann)).count).toBe(0);
    await removeFromCart(deps(), ann, c.groups[0].lines[0].id);
    expect((await cart(jo)).count).toBe(2);
    expect(await payCart(deps(), ann, org, pid, BASE)).toMatchObject({ ok: false });

    const pay = await payCart(deps(), jo, org, pid, BASE, undefined, true);
    expect(pay).toMatchObject({ ok: true, payInPage: { account: "acct_league" } });
    expect(s.checkouts[0].lines.map((l) => l.cents).sort()).toEqual([25000, 7000].sort());
    expect(await regOf(a)).toBeNull();
    expect((await cart(jo)).count).toBe(2); // cancelled or not finished: still there
    const pay1 = s.checkouts[0].id;
    const id1 = pay1.replace("cs_test_", "");
    expect(await confirmPayment(deps(), id1, pay1)).toMatchObject({ registered: false });
    s.paid.add(pay1);
    expect(await confirmPayment(deps(), id1, pay1)).toMatchObject({ ok: true, registered: true, paidNow: { programId: pid, org } });
    expect(await regOf(a)).toMatchObject({ paid: true });
    expect(await regOf(b)).toMatchObject({ paid: true });
    expect(await cart(jo)).toEqual({ groups: [], count: 0, gone: [] }); // gone quietly: they paid for it themselves
  });

  it("registered by someone else first: it comes out of the cart by itself, saying so; a payment never starts on a stale cart", async () => {
    const [a, b] = [await team(), await team("3")];
    await add(jo, a, ALL);
    await add(jo, b, ALL);
    // One cart at a time: it's in Jo's, for the same thing or any other first registration; Ann can still pay now.
    expect(await add(ann, a, day("2026-12-05"))).toEqual({ ok: false, message: expect.stringMatching(/is already in Jo X's cart \(ALL Season\)\.$/) });
    expect(await inCarts(db.pool, now, ann, { orgTeamId: a })).toEqual([{ programId: pid, mine: false, name: "Jo X", what: "ALL Season", invoiceId: null }]);
    expect((await inCarts(db.pool, now, jo, { orgTeamId: a }))[0]).toMatchObject({ mine: true });
    expect(await registerOrgTeam(deps(), ann, org, a, pid, ALL)).toMatchObject({ ok: true });
    expect(await payCart(deps(), jo, org, pid, BASE)).toMatchObject({ ok: false, message: expect.stringContaining("cart changed") });
    expect(s.checkouts).toHaveLength(0);
    expect(await inCarts(db.pool, now, ann, { orgTeamId: a })).toEqual([]); // registered: in no one's cart
    const c = await cart(jo);
    expect(c.count).toBe(1);
    expect(c.gone.map((g) => g.why)).toEqual([expect.stringMatching(/was registered for Winter by Ann X\.$/)]);
    await removeFromCart(deps(), jo, c.gone[0].id); // dismissed
    expect((await cart(jo)).gone).toEqual([]);
    expect(await payCart(deps(), jo, org, pid, BASE)).toMatchObject({ ok: true, pay: expect.any(String) });
    expect(s.checkouts[0].lines.map((l) => l.cents)).toEqual([25000]);
    // Archived: out too.
    await db.pool.query("update org_teams set archived_at = now(), archived_by = 't' where id = $1", [b]);
    expect((await cart(jo)).count).toBe(0);
  });

  it("a coach adds dates (their own cart) once the Director registered the team; dates added meanwhile come off; registration closed: can't pay", async () => {
    const a = await team();
    await db.pool.query("insert into org_team_coaches (team_id, coach_id, role, added_by) values ($1, '5550003', 'HeadCoach', 't')", [a]);
    expect(await add(cam, a, ALL)).toMatchObject({ ok: false, message: expect.stringContaining("registers the team first") });
    await registerOrgTeam(deps(), jo, org, a, pid, day("2026-12-05"));
    expect(await add(cam, a, day("2026-12-05"))).toMatchObject({ ok: false }); // already has it
    expect(await add(cam, a, day("2026-12-12", "2026-12-19"))).toEqual({ ok: true, replaced: false });
    expect((await cart(cam)).groups[0].lines[0]).toMatchObject({ adding: true, cents: 7000 });
    // Those dates are in Cam's cart: not in Jo's too. Another thing (a 2nd Game on Dec 5) may be.
    expect(await add(jo, a, day("2026-12-12"))).toEqual({ ok: false, message: expect.stringContaining("already in Cam X's cart") });
    expect(await add(jo, a, { allSeason: false, days: [{ date: "2026-12-05", kind: "single_2nd" }] })).toMatchObject({ ok: true });
    expect((await inCarts(db.pool, now, jo, { orgTeamId: a })).map((c) => [c.name, c.mine])).toEqual([["Cam X", false], ["Jo X", true]]);
    // Jo pays now for Dec 12 (not through a cart); Cam's item keeps only Dec 19.
    await registerOrPay(deps(), jo, org, a, pid, day("2026-12-12"), BASE);
    const p1 = s.checkouts[0].id;
    s.paid.add(p1);
    expect(await confirmPayment(deps(), p1.replace("cs_test_", ""), p1)).toMatchObject({ registered: true });
    expect((await cart(cam)).groups[0].lines[0]).toMatchObject({ what: "Dec 19 1 game", cents: 3500 });
    // Off the team's staff: out of Cam's cart.
    expect(await removeOrgTeamCoach(deps(), jo, org, a, "5550003")).toMatchObject({ ok: true });
    expect(await cart(cam)).toMatchObject({ count: 0, gone: [{ why: expect.stringContaining("no longer register") }] });
    // Closed: shown with why, not paid for.
    const b = await team("3");
    await removeFromCart(deps(), jo, (await cart(jo)).groups[0].lines[0].id);
    await add(jo, b, ALL);
    await db.pool.query("update scenic_programs set reg_closes = '2026-11-20' where id = $1", [pid]);
    const closed = await cart(jo);
    expect(closed.groups[0]).toMatchObject({ cents: 0, lines: [{ problem: "Registration is closed." }] });
    expect(await payCart(deps(), jo, org, pid, BASE)).toMatchObject({ ok: false, message: expect.stringContaining("registration isn't open") });
  });

  it("a Pay later organization chooses: pay now by card, or register now and owe it; the price is always the League's own", async () => {
    await savePriceGroup(deps(), dee, pid, null, { name: "Rec", allSeason: "50", payLater: true });
    const g = (await programPriceGroups(db.pool, pid))[0];
    await tagOrgs(deps(), dee, pid, [org], g.id);
    const a = await team();
    await add(jo, a, ALL);
    expect((await cart(jo)).groups[0]).toMatchObject({ cents: 5000, payLater: true });
    expect(await payCart(deps(), jo, org, pid, BASE)).toMatchObject({ ok: true, choose: { cents: 5000 } });
    expect(await regOf(a)).toBeNull();
    expect(await payCart(deps(), jo, org, pid, BASE, "later")).toEqual({ ok: true, registered: 1 });
    expect(await regOf(a)).toMatchObject({ paid: false });
    expect(await cart(jo)).toEqual({ groups: [], count: 0, gone: [] });
  });

  it("not paid for in 7 days: out of the cart (saying so), and it no longer holds the team; without card payments it waits", async () => {
    const a = await team();
    let t = now;
    const d = { pool: db.pool, stripe: s.api, now: () => t };
    expect(await addToCart(d, jo, pid, { org, orgTeamId: a }, ALL)).toMatchObject({ ok: true });
    expect((await getCart(d, jo, org)).groups[0].lines[0].until).toBe("2026-12-01");
    expect(await payCart({ ...d, stripe: null }, jo, org, pid, BASE)).toMatchObject({ ok: false, message: expect.stringContaining("Card payments aren't available") });
    expect(await regOf(a)).toBeNull(); // never registered unpaid without Pay later
    expect(await registerOrPay({ ...d, stripe: null }, jo, org, a, pid, ALL, BASE)).toMatchObject({ ok: false, message: expect.stringContaining("Card payments aren't available") });
    t = new Date(now.getTime() + 7 * 86_400_000 - 1000);
    expect((await getCart(d, jo, org)).count).toBe(1);
    expect(await addToCart(d, ann, pid, { org, orgTeamId: a }, ALL)).toMatchObject({ ok: false });
    t = new Date(now.getTime() + 7 * 86_400_000);
    expect(await addToCart(d, ann, pid, { org, orgTeamId: a }, ALL)).toMatchObject({ ok: true }); // Jo's ran out
    expect(await getCart(d, jo, org)).toMatchObject({ count: 0, gone: [{ why: expect.stringContaining("in your cart for 7 days") }] });
  });

  it("the League's Owners see everyone's carts for a program and register one now to pay later, case by case; only the rest is billed", async () => {
    const owen = person("5550009", "Owen");
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550009', 'Owen', 'X', '4235550009')");
    await grant(db.pool, "5550009 scenic-city Owner");
    const [a, b] = [await team(), await team("3")];
    await add(jo, a, ALL);
    await add(ann, b, day("2026-12-05"));
    expect(await programCarts(db.pool, jo, pid, now)).toBeNull();
    expect(await programCarts(db.pool, dee, pid, now)).toBeNull(); // an Admin, not an Owner
    const list = (await programCarts(db.pool, owen, pid, now))!;
    expect(list.map((x) => [x.who, x.what, x.cents])).toEqual([
      ["Ann X", "Dec 5 1 game", 3500],
      ["Jo X", "ALL Season", 25000],
    ]);
    expect(await registerPayLater(deps(), jo, list[1].id)).toMatchObject({ ok: false });
    expect(await registerPayLater(deps(), owen, list[0].id)).toMatchObject({ ok: true, org, programId: pid });
    expect(await registerPayLater(deps(), owen, list[0].id)).toMatchObject({ ok: false }); // once
    expect(await regOf(b)).toMatchObject({ paid: false });
    expect((await db.pool.query("select pay_later_by from scenic_registrations")).rows).toEqual([{ pay_later_by: "Owen X" }]);
    expect(await cart(ann)).toMatchObject({ count: 0, gone: [{ why: expect.stringContaining("to pay later: due Dec 4") }] });
    expect(await buildInvoice(db.pool, pid, org)).toMatchObject({ payLater: true, dueCents: 3500, dueOn: "2026-12-04" }); // the day before Dec 5
    expect(list[1].due).toBe("2026-12-04"); // ALL Season: the next Game Day
    const at = (d: string) => pastDueInvoices(db.pool, owen, "scenic-city", new Date(`${d}T17:00:00Z`));
    expect(await at("2026-12-04")).toEqual([]); // due that day
    expect(await at("2026-12-05")).toHaveLength(1); // past due the day of
    expect((await programCarts(db.pool, owen, pid, now))!.map((x) => x.who)).toEqual(["Jo X"]);

    // Paid, then more added to pay later: the invoice asks only for the rest.
    await db.pool.query("update scenic_registrations set paid = true, paid_set_by = 't'");
    await add(ann, b, day("2026-12-12"));
    const more = (await programCarts(db.pool, owen, pid, now))!.find((x) => x.adding)!;
    expect(more.cents).toBe(3500);
    expect(await registerPayLater(deps(), owen, more.id)).toMatchObject({ ok: true });
    expect(await buildInvoice(db.pool, pid, org)).toMatchObject({ totalCents: 7000, paidCents: 3500, dueCents: 3500, dueOn: "2026-12-11", lines: [{ paid: false, paidCents: 3500 }] });
  });

  it("an invoice requested from the cart: nothing is registered until it's paid (by card, or marked paid by the League); cancelled, back in the cart", async () => {
    const owen = person("5550009", "Owen");
    await db.pool.query("insert into users (coach_id, first_name, last_name, cell) values ('5550009', 'Owen', 'X', '4235550009')");
    await grant(db.pool, "5550009 scenic-city Owner");
    await db.pool.query("update users set email = lower(first_name) || '@example.com' where coach_id in ('5550001', '5550002')");
    const [a, b] = [await team(), await team("3")];
    expect(await requestInvoice(deps(), ann, org, pid)).toMatchObject({ ok: false }); // nothing in hers
    await add(ann, a, ALL);
    await add(ann, b, day("2026-12-12"));
    const r = await requestInvoice(deps(), ann, org, pid);
    if (!r.ok) throw new Error(r.message);
    expect((await cart(ann)).count).toBe(0); // it left the cart
    expect(await regOf(a)).toBeNull();
    const inv = (await requestedInvoice(deps(), jo, r.id))!; // the organization's Owner sees it
    expect(inv).toMatchObject({ state: "PENDING", cents: 28500, due: "2026-12-04", requestedBy: "Ann X", canPay: true, canMarkPaid: false });
    expect(await requestedInvoice(deps(), nat, r.id)).toBeNull();
    expect(await requestedInvoice(deps(), dee, r.id)).toBeNull(); // a League Admin, not an Owner
    expect((await requestedInvoice(deps(), owen, r.id))!).toMatchObject({ canPay: false, canMarkPaid: true });
    expect(await pendingInvoices(deps(), jo, { org })).toHaveLength(1);
    expect(await pendingInvoices(deps(), jo, { programId: pid })).toEqual([]);
    expect(await pendingInvoices(deps(), owen, { programId: pid })).toHaveLength(1);
    const mail = (await requestedInvoiceEmail(deps(), ann, r.id, BASE))!;
    expect(mail.to.sort()).toEqual(["ann@example.com", "jo@example.com"]);
    expect(mail.text).toContain("not registered until it's paid");
    expect(mail.text).toContain(`${BASE}/invoice/request/${r.id}`);
    // Its teams are spoken for; the League's carts list doesn't have them.
    expect(await add(jo, a, ALL)).toMatchObject({ ok: false, message: expect.stringContaining(`on invoice #${r.id}, requested by Ann X`) });
    expect(await add(ann, a, ALL)).toMatchObject({ ok: false });
    expect(await programCarts(db.pool, owen, pid, now)).toEqual([]);

    // Not yet paid by card: still nothing registered. Paid: registered together, paid.
    expect(await payRequested(deps(), nat, r.id, BASE)).toMatchObject({ ok: false });
    expect(await payRequested(deps(), jo, r.id, BASE, true)).toMatchObject({ ok: true, payInPage: { account: "acct_league" } });
    const cs = s.checkouts.at(-1)!.id;
    expect(await regOf(a)).toBeNull();
    s.paid.add(cs);
    expect(await confirmPayment(deps(), cs.replace("cs_test_", ""), cs)).toMatchObject({ registered: true });
    expect(await regOf(a)).toMatchObject({ paid: true });
    expect(await regOf(b)).toMatchObject({ paid: true });
    expect(await requestedInvoice(deps(), ann, r.id)).toMatchObject({ state: "PAID", paidBy: "Card (Stripe)", canPay: false });
    expect(await markRequestedPaid(deps(), owen, r.id)).toMatchObject({ ok: false }); // once

    // A check: the League's Owner marks it paid, and its team registers then.
    const c = await team();
    await add(jo, c, ALL);
    const r2 = await requestInvoice(deps(), jo, org, pid);
    if (!r2.ok) throw new Error(r2.message);
    expect(await markRequestedPaid(deps(), jo, r2.id)).toMatchObject({ ok: false });
    expect(await regOf(c)).toBeNull();
    expect(await markRequestedPaid(deps(), owen, r2.id)).toEqual({ ok: true, programId: pid, org, registered: 1 });
    expect(await regOf(c)).toMatchObject({ paid: true });

    // Cancelled: back in that person's cart.
    const d = await team("3");
    await add(jo, d, ALL);
    const r3 = await requestInvoice(deps(), jo, org, pid);
    if (!r3.ok) throw new Error(r3.message);
    expect(await cancelRequested(deps(), nat, r3.id)).toMatchObject({ ok: false });
    expect(await cancelRequested(deps(), ann, r3.id)).toEqual({ ok: true }); // she manages the teams
    expect((await cart(jo)).count).toBe(1);
    expect(await requestedInvoice(deps(), jo, r3.id)).toMatchObject({ state: "CLOSED" });

    // Not paid by its due date: closed, and the team is free again.
    const r4 = await requestInvoice(deps(), jo, org, pid);
    if (!r4.ok) throw new Error(r4.message);
    const late = { ...deps(), now: () => new Date("2026-12-05T15:00:00Z") };
    expect(await requestedInvoice(late, jo, r4.id)).toMatchObject({ state: "CLOSED" });
    expect(await payRequested(late, jo, r4.id, BASE)).toMatchObject({ ok: false });
    expect((await getCart(late, jo, org)).gone[0].why).toContain(`invoice #${r4.id} wasn't paid by Dec 4`);
    expect(await addToCart(late, ann, pid, { org, orgTeamId: d }, day("2026-12-12"))).toMatchObject({ ok: true });
    expect(await regOf(d)).toBeNull();
  });

  it("someone else registers a team on a requested invoice: it comes off; a Pay later organization doesn't need one", async () => {
    const [a, b] = [await team(), await team("3")];
    await add(ann, a, ALL);
    await add(ann, b, ALL);
    const r = await requestInvoice(deps(), ann, org, pid);
    if (!r.ok) throw new Error(r.message);
    await registerOrgTeam(deps(), jo, org, a, pid, ALL);
    expect(await requestedInvoice(deps(), ann, r.id)).toMatchObject({ cents: 25000, lines: [{}] });
    expect(await payRequested(deps(), ann, r.id, BASE)).toMatchObject({ ok: false, message: expect.stringContaining("changed") });
    expect(await payRequested(deps(), ann, r.id, BASE)).toMatchObject({ ok: true, pay: expect.any(String) });
    expect(s.checkouts.at(-1)!.lines.map((l) => l.cents)).toEqual([25000]);
    await savePriceGroup(deps(), dee, pid, null, { name: "Rec", allSeason: "50", payLater: true });
    await tagOrgs(deps(), dee, pid, [org], (await programPriceGroups(db.pool, pid))[0].id);
    const c = await team();
    await add(jo, c, ALL);
    expect(await requestInvoice(deps(), jo, org, pid)).toMatchObject({ ok: false, message: expect.stringContaining("Pay later") });
  });

  it("Register ALL: each team its own pick (REC: no 2nd Game), all or none; or all of them into the cart", async () => {
    const [a, b] = [await team(), await team("3")];
    const pre = await registerAllOrgTeams(deps(), jo, org, pid, true);
    if (!pre.ok) throw new Error(pre.message);
    expect(pre.terms).toMatchObject({ gameDates: ["2026-12-05", "2026-12-12", "2026-12-19"], today: "2026-11-24" });
    expect(pre.teams.map((t) => [t.level, t.choice, t.cents])).toEqual([
      ["COMP", ALL, 25000],
      ["COMP", ALL, 25000],
    ]);
    // A pick that can't be is refused (all or none), named; nothing unreadable.
    const bad = await registerAllOrgTeams(deps(), jo, org, pid, false, [a, b], null, { [b]: day("2026-12-25") });
    expect(bad).toMatchObject({ ok: false, message: expect.stringContaining("isn't one of this League's Game Days") });
    expect(await registerAllOrgTeams(deps(), jo, org, pid, false, [a], null, { [a]: "x" })).toMatchObject({ ok: false });
    expect(await regOf(a)).toBeNull();
    // Paid by card: each at its own price; registered as picked once paid.
    let paymentId = "";
    const pay = {
      feePayer: "org" as const,
      record: async (q: PoolClient, teams: PayTeam[]) => (paymentId = await insertPayment(q, { account_id: "acct_league", fee_payer: "org", live: false }, { programId: pid, teamOrg: org, teams, startedBy: "Jo X", now })),
    };
    const picks = { [b]: { allSeason: false, days: [{ date: "2026-12-05", kind: "single_1" }, { date: "2026-12-05", kind: "single_2nd" }] } };
    const r = await registerAllOrgTeams(deps(), jo, org, pid, false, [a, b], pay, picks);
    expect(r).toMatchObject({ ok: true, payer: "org", paymentId: expect.any(String) });
    await openCheckout(deps(), paymentId, BASE, "/x");
    expect(s.checkouts[0].lines.map((l) => l.cents).sort()).toEqual([25000, 5500].sort());
    const cs = s.checkouts[0].id;
    s.paid.add(cs);
    expect(await confirmPayment(deps(), paymentId, cs)).toMatchObject({ registered: true });
    expect((await teamPrograms(deps(), jo, org, b))!.programs[0].entry).toMatchObject({ allSeason: false, perDate: { "2026-12-05": 2 } });

    // Into the cart together; one already spoken for is named, the others go in.
    const [c, d] = [await team(), await team("3")];
    await add(ann, c, ALL);
    expect(await addManyToCart(deps(), nat, pid, org, [{ id: d, choice: ALL }])).toMatchObject({ ok: false });
    const many = await addManyToCart(deps(), jo, pid, org, [
      { id: c, choice: ALL },
      { id: d, choice: day("2026-12-12") },
    ]);
    expect(many).toEqual({ ok: true, added: 1, refused: [expect.stringContaining("already in Ann X's cart")] });
    expect((await cart(jo)).groups[0].lines).toMatchObject([{ what: "Dec 12 1 game", cents: 3500 }]);

    // REC: ALL Season only, whatever else is picked; not in the cart either.
    await db.pool.query("insert into org_features (org, feature, source, turned_on_by) values ($1, 'court-sync', 'setup', 't') on conflict do nothing", [org]);
    await addDivision(deps(), dee, pid, { gender: "Girls", from: 3, to: 4, levels: ["REC"] });
    const rec = ((await createOrgTeam(deps(), jo, org, { gender: "Girls", grades: ["4"], level: "REC" })) as { id: string }).id;
    const mixed = await registerAllOrgTeams(deps(), jo, org, pid, true);
    if (!mixed.ok) throw new Error(mixed.message);
    expect(mixed.teams.find((t) => t.id === rec)).toMatchObject({ level: "REC", choice: ALL });
    expect(await registerAllOrgTeams(deps(), jo, org, pid, false, [rec], null, { [rec]: day("2026-12-05") })).toMatchObject({ ok: false, message: expect.stringContaining("ALL Season only") });
    expect(await add(jo, rec, day("2026-12-05"))).toMatchObject({ ok: false });
    expect(await add(jo, rec, ALL)).toMatchObject({ ok: true });

    // ALL Season closed: each picks its dates.
    await db.pool.query("update scenic_program_options set closes_on = '2026-11-20' where program_id = $1 and kind = 'all_season'", [pid]);
    const late = await registerAllOrgTeams(deps(), jo, org, pid, true);
    if (!late.ok) throw new Error(late.message);
    expect(late.teams.map((t) => t.choice)).toEqual([null, null]);
    expect(late.skipped).toEqual([expect.stringContaining("ALL Season registration closed")]); // the REC team
  });
});
