import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../auth/service";
import { registerAllOrgTeams, teamPrograms } from "../org-leagues";
import { createOrganization } from "../org-signup";
import { createOrgTeam } from "../org-teams";
import { addDivision, deletePriceGroup, saveProgram, savePriceGroup, tagOrgs } from "../scenic-programs";
import { createTestDb, grant } from "../testing/db";
import type { StripeApi } from "./connect";
import { cardFee, confirmPayment, insertPayment, openCheckout, payee, registerOrPay } from "./registration";
import { handleStripeEvent } from "./webhook";
import { cardPayments, refundPayment } from "./refunds";
import { buildInvoice, invoiceEmail, invoiceFor, openInvoices, payInvoice } from "../invoices";
import { deleteOrgTeam } from "../org-teams";

const ALL = { allSeason: true, days: [] };
const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});
const jo = person("5550001", "Jo"); // East Ridge Owner
const dee = person("9913694", "Dee"); // Scenic City Admin
const org = "east-ridge-parks-and-rec";
const BASE = "https://app.test";

// A fake Stripe: remembers each Checkout (its lines) and which are paid.
function fakeStripe() {
  const checkouts: { id: string; account: string; lines: { name: string; cents: number }[]; successUrl: string; cancelUrl: string }[] = [];
  const paid = new Set<string>();
  const refunds: { account: string; sessionId: string; cents: number; key: string }[] = [];
  const api: StripeApi = {
    live: false,
    createAccount: async () => "acct_x",
    isReady: async () => true,
    onboardingLink: async () => "https://connect.stripe.test",
    createCheckout: async (p) => {
      const id = `cs_test_${p.ref}`;
      checkouts.push({ id, account: p.account, lines: p.lines, successUrl: p.successUrl, cancelUrl: p.cancelUrl });
      return { id, url: `https://checkout.stripe.test/${id}` };
    },
    checkoutPaid: async ({ id }) => paid.has(id),
    refund: async (r) => {
      refunds.push(r);
      return `re_test_${refunds.length}`;
    },
  };
  return { api, checkouts, paid, refunds };
}

describe("paying to register", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  const now = new Date("2026-11-02T15:00:00Z");
  let pid = "";

  beforeEach(async () => {
    await db.reset();
    await db.pool.query("delete from org_role_types where org not in ('thunder', 'scenic-city')");
    await db.pool.query("delete from organizations where slug not in ('thunder', 'scenic-city')");
    await db.pool.query(
      "insert into users (coach_id, first_name, last_name, cell) values ('5550001', 'Jo', 'X', '4235550001'), ('9913694', 'Dee', 'X', '4239913694')",
    );
    await grant(db.pool, "9913694 scenic-city Director", "9913694 scenic-city Admin");
    const deps = { pool: db.pool, now: () => now };
    await createOrganization(
      deps,
      jo,
      { name: "East Ridge Parks & Rec", short: "East Ridge", kind: "Organization", color: "#0f766e", features: ["court-club"] },
      null,
    );
    await db.pool.query(
      "insert into org_features (org, feature, source, turned_on_by) values ($1, 'court-sync', 'setup', 'test') on conflict do nothing",
      [org],
    );
    pid = (
      (await saveProgram(deps, dee, null, {
        kind: "League",
        name: "Winter League 2027",
        startsOn: "2027-01-09",
        endsOn: "2027-03-06",
        regOpens: "2026-11-01",
        regCloses: "2026-12-15",
        fee: "$150",
      })) as { id: string }
    ).id;
    await addDivision(deps, dee, pid, { gender: "Boys", from: 3, to: 4, levels: ["REC"] });
  });

  const team = async () =>
    ((await createOrgTeam({ pool: db.pool, now: () => now }, jo, org, { gender: "Boys", grades: ["4"], level: "REC" })) as { id: string }).id;
  const regOf = async (tid: string) => (await teamPrograms({ pool: db.pool, now: () => now }, jo, org, tid))!.programs[0].registered;

  it("card fee for the team: after Stripe's 2.9% + 30¢ the organization still gets the full price", () => {
    for (const c of [4000, 15000, 25000]) {
      const f = cardFee(c);
      expect(Math.round((c + f) * 0.971 - 30)).toBeGreaterThanOrEqual(c);
      expect(Math.round((c + f - 1) * 0.971 - 30)).toBeLessThan(c + 1);
    }
    expect(cardFee(25000)).toBe(778);
    expect(cardFee(0)).toBe(0);
  });

  it("no Stripe ready: registers at once (paid outside the app)", async () => {
    const s = fakeStripe();
    const tid = await team();
    expect(await registerOrPay({ pool: db.pool, stripe: null, now: () => now }, jo, org, tid, pid, ALL, BASE)).toMatchObject({
      ok: true,
      division: "Boys 3rd–4th · 4th REC · Pool A",
    });
    // Connected but Stripe still needs details: the same.
    await db.pool.query(
      "insert into org_stripe (org, livemode, account_id, connected_by, charges_enabled) values ('scenic-city', false, 'acct_league', 'Dee X', false)",
    );
    const t2 = await team();
    expect(await registerOrPay({ pool: db.pool, stripe: s.api, now: () => now }, jo, org, t2, pid, ALL, BASE)).toMatchObject({
      ok: true,
      division: "Boys 3rd–4th · 4th REC · Pool A",
    });
    expect(s.checkouts).toEqual([]);
  });

  it("Stripe ready: off to Checkout; registered only once Stripe says it's paid; once only; card fee added when the team pays it", async () => {
    const s = fakeStripe();
    const deps = { pool: db.pool, stripe: s.api, now: () => now };
    await db.pool.query(
      "insert into org_stripe (org, livemode, account_id, connected_by, charges_enabled) values ('scenic-city', false, 'acct_league', 'Dee X', true)",
    );
    const tid = await team();
    expect(await registerOrPay(deps, dee, org, tid, pid, ALL, BASE)).toMatchObject({ ok: false }); // not East Ridge's manager
    const r = await registerOrPay(deps, jo, org, tid, pid, ALL, BASE);
    const id = String((r as { pay: string }).pay.split("cs_test_")[1]); // our payment's id
    const cs = `cs_test_${id}`;
    expect(r).toEqual({ ok: true, pay: `https://checkout.stripe.test/${cs}` });
    expect(s.checkouts[0]).toMatchObject({
      account: "acct_league", // the League's own Stripe account
      lines: [{ name: "Winter League 2027: ER 4B East Ridge TBD", cents: 15000 }], // the organization pays the card fee
      successUrl: `${BASE}/stripe/paid?p=${id}&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${BASE}/org/${org}/teams/${tid}?paid=cancelled&tab=register`,
    });
    expect(await regOf(tid)).toBeNull(); // not registered yet

    // Back before it's paid: still not registered. A wrong session: not found.
    expect(await confirmPayment(deps, id, cs)).toMatchObject({ ok: true, registered: false });
    expect(await confirmPayment(deps, id, "cs_test_x9")).toMatchObject({ ok: false, message: "That payment wasn't found." });
    expect(await regOf(tid)).toBeNull();

    s.paid.add(cs);
    expect(await confirmPayment(deps, id, cs)).toEqual({
      ok: true,
      registered: true,
      teamPage: `/org/${org}/teams/${tid}`,
      message: "Paid and registered: Boys 3rd–4th · 4th REC · Pool A.",
      paidNow: { programId: pid, org }, // its invoice is emailed (once)
    });
    expect(await regOf(tid)).toMatchObject({ paid: true, by: "Jo X" });
    expect(await confirmPayment(deps, id, cs)).toMatchObject({ ok: true, registered: true, message: "Paid and registered." });
    expect((await db.pool.query("select count(*)::int as n from scenic_registrations")).rows[0].n).toBe(1);

    // Already registered: nothing more to pay, so it says so (no Checkout).
    expect(await registerOrPay(deps, jo, org, tid, pid, ALL, BASE)).toMatchObject({ ok: false, message: "Already registered for ALL Season." });

    // The team pays the card fee: it's its own line.
    await db.pool.query("update org_stripe set fee_payer = 'team'");
    const t2 = await team();
    expect(await registerOrPay(deps, jo, org, t2, pid, ALL, BASE)).toMatchObject({ ok: true, pay: expect.any(String) });
    expect(s.checkouts[1].lines).toEqual([
      { name: "Winter League 2027: ER 4B East Ridge TBD 2", cents: 15000 }, // the second TBD team's name
      { name: "Card processing", cents: cardFee(15000) },
    ]);
  });

  it("paid, but the team can't be registered now: kept as failed with why (for a refund)", async () => {
    const s = fakeStripe();
    const deps = { pool: db.pool, stripe: s.api, now: () => now };
    await db.pool.query(
      "insert into org_stripe (org, livemode, account_id, connected_by, charges_enabled) values ('scenic-city', false, 'acct_league', 'Dee X', true)",
    );
    const tid = await team();
    const r = (await registerOrPay(deps, jo, org, tid, pid, ALL, BASE)) as { pay: string };
    const cs = r.pay.split("/").at(-1)!;
    await db.pool.query("delete from scenic_divisions where program_id = $1", [pid]);
    s.paid.add(cs);
    expect(await confirmPayment(deps, cs.slice("cs_test_".length), cs)).toMatchObject({ ok: false, message: expect.stringContaining("Paid, but not registered") });
    expect((await db.pool.query("select status, error from registration_payments")).rows[0]).toMatchObject({ status: "failed" });
    expect(await regOf(tid)).toBeNull();
  });

  it("Stripe's notice registers a paid team even if its manager never came back; other notices are ignored", async () => {
    const s = fakeStripe();
    const deps = { pool: db.pool, stripe: s.api, now: () => now };
    await db.pool.query(
      "insert into org_stripe (org, livemode, account_id, connected_by, charges_enabled) values ('scenic-city', false, 'acct_league', 'Dee X', true)",
    );
    const tid = await team();
    const r = (await registerOrPay(deps, jo, org, tid, pid, ALL, BASE)) as { pay: string };
    const cs = r.pay.split("/").at(-1)!;
    const ref = cs.slice("cs_test_".length);
    const notice = (type: string, metadata: Record<string, string> | null = { courtcaptain_payment: ref }) => ({
      type,
      account: "acct_league",
      data: { object: { id: cs, object: "checkout.session", metadata } },
    });
    expect(await handleStripeEvent(deps, notice("customer.created"))).toBe("ignored");
    expect(await handleStripeEvent(deps, notice("checkout.session.completed", null))).toBe("not ours");
    // A notice saying it's paid when Stripe says it isn't: not registered.
    expect(await handleStripeEvent(deps, notice("checkout.session.completed"))).toBe("not paid yet");
    expect(await regOf(tid)).toBeNull();
    // Someone else's payment id with this session: not found.
    expect(await handleStripeEvent(deps, notice("checkout.session.completed", { courtcaptain_payment: "999999" }))).toMatch(/not registered/);
    s.paid.add(cs);
    expect(await handleStripeEvent(deps, notice("checkout.session.completed"))).toBe("registered");
    expect(await regOf(tid)).toMatchObject({ paid: true });
    // Stripe sends it again, and the manager comes back too: still once.
    expect(await handleStripeEvent(deps, notice("checkout.session.completed"))).toBe("registered");
    expect(await confirmPayment(deps, ref, cs)).toMatchObject({ ok: true, registered: true });
    expect((await db.pool.query("select count(*)::int as n from scenic_registrations")).rows[0].n).toBe(1);
  });
  it("Register ALL with Stripe ready: the total in its confirmation, one payment for the checked teams, registered once paid", async () => {
    const s = fakeStripe();
    const deps = { pool: db.pool, stripe: s.api, now: () => now };
    await db.pool.query(
      "insert into org_stripe (org, livemode, account_id, connected_by, charges_enabled, fee_payer) values ('scenic-city', false, 'acct_league', 'Dee X', true, 'team')",
    );
    const [t1, t2] = [await team(), await team()];
    const to = (await payee(db.pool, s.api))!;
    const pay = {
      feePayer: to.fee_payer,
      record: (q: import("pg").PoolClient, teams: Parameters<typeof insertPayment>[2]["teams"]) =>
        insertPayment(q, to, { programId: pid, teamOrg: org, teams, startedBy: "Jo X", now }),
    };
    // The confirmation: each team's price and who pays the card fee; nothing kept.
    const plan = await registerAllOrgTeams(deps, jo, org, pid, true, undefined, pay);
    expect(plan).toMatchObject({ ok: true, payer: "team", teams: [{ cents: 15000 }, { cents: 15000 }] });
    expect((await db.pool.query("select count(*)::int n from registration_payments")).rows[0].n).toBe(0);
    // Register: one payment for both, nothing registered (and no Register ALL batch) until it's paid.
    const r = await registerAllOrgTeams(deps, jo, org, pid, false, [t1, t2], pay);
    if (!r.ok || !r.paymentId) throw new Error(JSON.stringify(r));
    expect(r.batchId).toBeNull();
    expect(await regOf(t1)).toBeNull();
    const url = await openCheckout(deps, r.paymentId, BASE, `/org/${org}?open=register&paid=cancelled`);
    expect(s.checkouts[0].lines.map((l) => l.cents)).toEqual([15000, 15000, cardFee(30000)]);
    const cs = url.split("/").at(-1)!;
    s.paid.add(cs);
    expect(await confirmPayment(deps, r.paymentId, cs)).toMatchObject({ ok: true, registered: true, message: "Paid and registered 2 teams." });
    expect(await regOf(t1)).toMatchObject({ paid: true });
    expect(await regOf(t2)).toMatchObject({ paid: true });
  });
  it("refunds: the League's Owners refund any amount up to what's left; full turns Paid off; a deleted team's payment stays", async () => {
    const s = fakeStripe();
    const deps = { pool: db.pool, stripe: s.api, now: () => now };
    await db.pool.query(
      "insert into org_stripe (org, livemode, account_id, connected_by, charges_enabled) values ('scenic-city', false, 'acct_league', 'Dee X', true)",
    );
    const tid = await team();
    const r = (await registerOrPay(deps, jo, org, tid, pid, ALL, BASE)) as { pay: string };
    const cs = r.pay.split("/").at(-1)!;
    const id = cs.slice("cs_test_".length);
    s.paid.add(cs);
    await confirmPayment(deps, id, cs);

    // Only Scenic City's Owners.
    expect(await cardPayments(db.pool, dee, pid, false)).toBeNull();
    expect(await refundPayment(deps, jo, id, 100)).toMatchObject({ ok: false });
    await grant(db.pool, "9913694 scenic-city Owner");
    expect(await cardPayments(db.pool, dee, pid, false)).toMatchObject([
      { id, paidCents: 15000, refundedCents: 0, status: "registered", teams: [{ name: "ER 4B East Ridge TBD", state: "registered" }] },
    ]);

    expect(await refundPayment(deps, dee, id, 20000)).toEqual({ ok: false, message: "At most $150.00 is left to refund." });
    expect(await refundPayment(deps, dee, id, 0)).toMatchObject({ ok: false });
    expect(await refundPayment(deps, dee, id, 5000)).toEqual({ ok: true, left: 10000 });
    expect(s.refunds[0]).toEqual({ account: "acct_league", sessionId: cs, cents: 5000, key: `cc-refund-${id}-0-5000` });
    expect(await regOf(tid)).toMatchObject({ paid: true }); // part refunded: still paid
    expect(await refundPayment(deps, dee, id, 10000)).toEqual({ ok: true, left: 0 });
    expect((await db.pool.query("select paid, paid_set_by from scenic_registrations")).rows[0]).toEqual({ paid: false, paid_set_by: "Refunded by Dee X" });
    expect(await refundPayment(deps, dee, id, 100)).toEqual({ ok: false, message: "It's already refunded in full." });
    expect(await cardPayments(db.pool, dee, pid, false)).toMatchObject([{ refundedCents: 15000, refunds: [{ cents: 5000 }, { cents: 10000 }] }]);

    // Deleting the team (not on the schedule) keeps its payment, by name.
    expect(await deleteOrgTeam(deps, jo, org, tid)).toEqual({ ok: true });
    expect(await cardPayments(db.pool, dee, pid, false)).toMatchObject([{ id, teams: [{ name: "ER 4B East Ridge TBD", state: "deleted" }] }]);
  });
  it("an organization's own ALL Season price is what it's charged; Pay later registers it without paying by card", async () => {
    const s = fakeStripe();
    const deps = { pool: db.pool, stripe: s.api, now: () => now };
    await db.pool.query(
      "insert into org_stripe (org, livemode, account_id, connected_by, charges_enabled) values ('scenic-city', false, 'acct_league', 'Dee X', true)",
    );
    // Only a Director of Programs makes groups and tags organizations.
    expect(await savePriceGroup(deps, jo, pid, null, { name: "Partners", allSeason: "100", payLater: false })).toMatchObject({ ok: false });
    expect(await savePriceGroup(deps, dee, pid, null, { name: "Partners", allSeason: "abc", payLater: false })).toMatchObject({ ok: false });
    const g = await savePriceGroup(deps, dee, pid, null, { name: "Partners", allSeason: "$100", payLater: false });
    if (!g.ok) throw new Error(g.message);
    expect(await savePriceGroup(deps, dee, pid, null, { name: "partners", allSeason: "", payLater: true })).toEqual({
      ok: false,
      message: "There's already a group with that name.",
    });
    expect(await tagOrgs(deps, jo, pid, [org], g.id)).toMatchObject({ ok: false });
    expect(await tagOrgs(deps, dee, pid, [org], g.id)).toEqual({ ok: true });
    const t1 = await team();
    // The team page shows its group's price, and it's charged that.
    const shown = (await teamPrograms(deps, jo, org, t1))!.programs[0].options.find((o) => o.kind === "all_season");
    expect(shown?.feeCents).toBe(10000);
    expect(await registerOrPay(deps, jo, org, t1, pid, ALL, BASE)).toMatchObject({ ok: true, pay: expect.any(String) });
    expect(s.checkouts[0].lines).toEqual([{ name: "Winter League 2027: ER 4B East Ridge TBD", cents: 10000 }]);

    // The group changed to Pay later (standard price): asked first; Pay later registers at once, no Checkout, not paid.
    expect(await savePriceGroup(deps, dee, pid, g.id, { name: "Invited", allSeason: "", payLater: true })).toEqual({ ok: true, id: g.id });
    const t2 = await team();
    expect(await registerOrPay(deps, jo, org, t2, pid, ALL, BASE)).toEqual({ ok: true, choose: { cents: 15000, card: 0 } });
    expect(await regOf(t2)).toBeNull(); // nothing yet
    expect(await registerOrPay(deps, jo, org, t2, pid, ALL, BASE, "later")).toMatchObject({ ok: true, division: expect.any(String) });
    expect(s.checkouts).toHaveLength(1);
    expect(await regOf(t2)).toMatchObject({ paid: false });
    // Group deleted: untagged, the standard price paid by card again.
    expect(await deletePriceGroup(deps, dee, pid, g.id)).toEqual({ ok: true });
    const t3 = await team();
    expect(await registerOrPay(deps, jo, org, t3, pid, ALL, BASE)).toMatchObject({ ok: true, pay: expect.any(String) });
    expect(s.checkouts[1].lines[0].cents).toBe(15000);
  });
  it("invoices: a Pay later registration has a balance due; paying it by card marks the team Paid; the email says which", async () => {
    const s = fakeStripe();
    const deps = { pool: db.pool, stripe: s.api, now: () => now };
    await db.pool.query(
      "insert into org_stripe (org, livemode, account_id, connected_by, charges_enabled) values ('scenic-city', false, 'acct_league', 'Dee X', true)",
    );
    await db.pool.query("update users set email = 'jo@example.com' where coach_id = '5550001'");
    const g = await savePriceGroup(deps, dee, pid, null, { name: "Invited", allSeason: "120", payLater: true });
    if (!g.ok) throw new Error(g.message);
    await tagOrgs(deps, dee, pid, [org], g.id);
    const tid = await team();
    // Asked first (Pay later group); "card" would go to Stripe; "later" registers now.
    expect(await registerOrPay(deps, jo, org, tid, pid, ALL, BASE)).toEqual({ ok: true, choose: { cents: 12000, card: 0 } });
    expect(await registerOrPay(deps, jo, org, tid, pid, ALL, BASE, "later")).toMatchObject({ ok: true, division: expect.any(String) });

    const inv = await buildInvoice(db.pool, pid, org);
    expect(inv).toMatchObject({
      from: expect.stringContaining("Scenic City"),
      orgName: "East Ridge Parks & Rec",
      payLater: true,
      totalCents: 12000,
      paidCents: 0,
      dueCents: 12000,
      lines: [{ team: "ER 4B East Ridge TBD", what: "ALL Season", cents: 12000, paid: false }],
    });
    // Only its managers and the League's Owners see it.
    expect(await invoiceFor(db.pool, dee, pid, org)).toBeNull();
    expect(await invoiceFor(db.pool, jo, pid, org)).toMatchObject({ dueCents: 12000 });
    expect(await openInvoices(db.pool, jo, org)).toHaveLength(1);
    const mail = (await invoiceEmail(db.pool, pid, org, "https://app.test"))!;
    expect(mail.to).toEqual(["jo@example.com"]);
    expect(mail.subject).toContain("PAY LATER");
    expect(mail.text).toContain(`Balance due: $120.00`);
    expect(mail.text).toContain(`https://app.test/invoice/${org}/${pid}`);

    // Pay it by card: one Checkout for the unpaid team; marked Paid once Stripe says so.
    const r = await payInvoice(deps, jo, pid, org, BASE);
    if (!r.ok) throw new Error(r.message);
    expect(s.checkouts[0].lines).toEqual([{ name: "Winter League 2027: ER 4B East Ridge TBD", cents: 12000 }]);
    expect(s.checkouts[0].cancelUrl).toBe(`${BASE}/invoice/${org}/${pid}?paid=cancelled`);
    const cs = r.pay.split("/").at(-1)!;
    s.paid.add(cs);
    expect(await confirmPayment(deps, cs.slice("cs_test_".length), cs)).toEqual({
      ok: true,
      registered: true,
      teamPage: `/invoice/${org}/${pid}`,
      message: "Paid: the invoice is updated.",
      paidNow: { programId: pid, org },
    });
    expect(await buildInvoice(db.pool, pid, org)).toMatchObject({ paidCents: 12000, dueCents: 0, lines: [{ paid: true, paidBy: "Card (Stripe)" }] });
    expect(await openInvoices(db.pool, jo, org)).toEqual([]);
    expect((await invoiceEmail(db.pool, pid, org, "https://app.test"))!.subject).toContain("PAID");
    expect(await payInvoice(deps, jo, pid, org, BASE)).toEqual({ ok: false, message: "Nothing is due on this invoice." });
  });
});
