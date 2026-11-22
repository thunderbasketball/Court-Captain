import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "../auth/service";
import { createTestDb, grant } from "../testing/db";
import { paymentStatus, refresh, resumeConnect, startConnect, type StripeApi } from "./connect";

// A fake Stripe: counts accounts made, remembers links, and says whether each account can take payments.
function fakeStripe(live = false) {
  const made: { id: string; name?: string; email?: string; org?: string }[] = [];
  const links: { account: string; refresh_url: string; return_url: string }[] = [];
  const ready = new Set<string>();
  const api: StripeApi = {
    live,
    createAccount: async ({ name, email, org }) => {
      await new Promise((r) => setTimeout(r, 20)); // slow enough for a double tap to overlap
      const id = `acct_test${made.length + 1}`;
      made.push({ id, name, email: email ?? undefined, org });
      return id;
    },
    isReady: async (id) => ready.has(id),
    onboardingLink: async (p) => {
      links.push({ account: p.account, refresh_url: p.refreshUrl, return_url: p.returnUrl });
      return `https://connect.stripe.test/setup/${p.account}/${links.length}`;
    },
    createCheckout: async (p) => ({ id: `cs_test_${p.ref}`, url: `https://checkout.stripe.test/${p.ref}` }),
    checkoutPaid: async () => false,
    refund: async () => "re_x",
  };
  return { api, made, links, ready };
}

const person = (coachId: string, firstName: string): SessionUser => ({
  coachId,
  firstName,
  lastName: "X",
  isDirector: false,
  isCoach: false,
  requestPending: false,
  hasThunderRole: false,
});

describe("Payments: an organization's Stripe account", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let t = new Date("2026-11-20T15:00:00Z");
  const owner = person("5550001", "Olive");
  const admin = person("5550002", "Adam");
  beforeAll(async () => {
    db = await createTestDb();
  }, 30_000);
  afterAll(async () => db?.drop());
  beforeEach(async () => {
    await db.reset();
    t = new Date("2026-11-20T15:00:00Z");
    await db.pool.query("delete from org_stripe");
    await db.pool.query(
      `insert into users (coach_id, first_name, last_name, cell, active) values
         ('5550001', 'Olive', 'X', '4235550001', true), ('5550002', 'Adam', 'X', '4235550002', true)`,
    );
    await grant(db.pool, "5550001 scenic-city Owner", "5550002 scenic-city Admin");
  });
  const deps = (s: StripeApi | null) => ({ pool: db.pool, stripe: s, now: () => t });
  const info = { name: "Scenic City Basketball", email: "olive@example.com" };

  it("only Owners see it or connect; without CourtCaptain's keys it says so", async () => {
    const s = fakeStripe();
    expect(await paymentStatus(deps(s.api), admin, "scenic-city")).toBeNull();
    expect(await startConnect(deps(s.api), admin, "scenic-city", "http://x", info)).toEqual({
      ok: false,
      message: "Only the organization's Owners can connect Stripe.",
    });
    expect(await startConnect(deps(s.api), owner, "thunder", "http://x", info)).toMatchObject({ ok: false }); // not its Owner
    expect(s.made).toHaveLength(0);
    expect(await paymentStatus(deps(null), owner, "scenic-city")).toEqual({ state: "not-set-up" });
    expect(await paymentStatus(deps(s.api), owner, "scenic-city")).toEqual({ state: "not-connected" });
  });

  it("Connect Stripe makes one account (even on a double tap) and a sign-up link back to this site", async () => {
    const s = fakeStripe();
    const [a, b] = await Promise.all([
      startConnect(deps(s.api), owner, "scenic-city", "https://court-captain.com", info),
      startConnect(deps(s.api), owner, "scenic-city", "https://court-captain.com", info),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(s.made).toEqual([{ id: "acct_test1", name: "Scenic City Basketball", email: "olive@example.com", org: "scenic-city" }]);
    expect(s.links[0]).toMatchObject({
      account: "acct_test1",
      refresh_url: "https://court-captain.com/stripe/connect?org=scenic-city",
      return_url: "https://court-captain.com/stripe/return?org=scenic-city",
    });
    expect(await paymentStatus(deps(s.api), owner, "scenic-city")).toMatchObject({
      state: "pending",
      account: "acct_test1",
      connectedBy: "Olive X",
      live: false,
    });
  });

  it("ready once Stripe says it can take payments; checks Stripe at most every 10 minutes while pending", async () => {
    const s = fakeStripe();
    await startConnect(deps(s.api), owner, "scenic-city", "http://x", info);
    await refresh(deps(s.api), "scenic-city"); // back from Stripe, not finished
    s.ready.add("acct_test1");
    t = new Date("2026-11-20T15:05:00Z");
    expect((await paymentStatus(deps(s.api), owner, "scenic-city"))?.state).toBe("pending"); // asked 5 minutes ago
    t = new Date("2026-11-20T15:11:00Z");
    expect((await paymentStatus(deps(s.api), owner, "scenic-city"))?.state).toBe("ready");
  });

  it("a Stripe hiccup shows the last answer", async () => {
    const s = fakeStripe();
    await startConnect(deps(s.api), owner, "scenic-city", "http://x", info);
    s.api.isReady = async () => {
      throw new Error("Stripe is down");
    };
    expect((await paymentStatus(deps(s.api), owner, "scenic-city"))?.state).toBe("pending");
  });

  it("an expired link gets a fresh one for the same account; test and live accounts are separate", async () => {
    const s = fakeStripe();
    expect(await resumeConnect(deps(s.api), owner, "scenic-city", "http://x")).toMatchObject({ ok: false });
    await startConnect(deps(s.api), owner, "scenic-city", "http://x", info);
    expect(await resumeConnect(deps(s.api), owner, "scenic-city", "http://x")).toEqual({ ok: true, url: "https://connect.stripe.test/setup/acct_test1/2" });
    expect(s.made).toHaveLength(1);
    const live = fakeStripe(true);
    expect(await paymentStatus(deps(live.api), owner, "scenic-city")).toEqual({ state: "not-connected" });
  });
});
