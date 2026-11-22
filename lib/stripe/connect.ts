// Payments: an organization's Owners connect its own Stripe account (Standard, through CourtCaptain's Connect platform),
// so teams can pay its registration fees by card straight to it (SPEC.md section 14). Each step checks the viewer is an
// Owner of that organization on the server. Stripe itself is passed in (`deps.stripe`), so tests use a fake.
import type { Pool } from "pg";
import type { SessionUser } from "../auth/service";
import { isOrgOwner } from "../org-admin";
import { isOrgSlug } from "../orgs";
import { withTx } from "../sql";

// What the app asks of Stripe (lib/stripe/client.ts does it with Stripe's Accounts v2; tests pass a fake).
export type StripeApi = {
  live: boolean; // live keys (real money) or test keys
  // A new organization's own Stripe account (full Stripe dashboard; it pays Stripe's fees and handles refunds and disputes).
  createAccount(p: { name: string; email: string | null; org: string }): Promise<string>; // acct_…
  // Whether it can take card payments yet.
  isReady(account: string): Promise<boolean>;
  // Stripe's sign-up (or finish-up) page for it, and where Stripe sends them back.
  onboardingLink(p: { account: string; refreshUrl: string; returnUrl: string }): Promise<string>;
  // A Stripe Checkout page on the organization's own account (the team pays it directly), and whether it's been paid.
  createCheckout(p: {
    account: string;
    lines: { name: string; cents: number }[];
    successUrl: string; // Stripe fills in {CHECKOUT_SESSION_ID}
    cancelUrl: string;
    ref: string; // our payment's id, kept on Stripe's side too
  }): Promise<{ id: string; url: string }>;
  checkoutPaid(p: { account: string; id: string }): Promise<boolean>;
  // Refunds part (or all) of a Checkout's payment on the organization's account; `key`: the same refund isn't made twice.
  refund(p: { account: string; sessionId: string; cents: number; key: string }): Promise<string>;
};

type Deps = { pool: Pool; stripe: StripeApi | null; now: () => Date };

export type PaymentStatus =
  | { state: "not-set-up" } // CourtCaptain has no Stripe keys yet
  | { state: "not-connected" }
  | {
      state: "pending" | "ready"; // ready: Stripe says it can take payments
      account: string; // acct_…
      connectedBy: string;
      connectedAt: Date;
      live: boolean;
      feePayer: "org" | "team"; // who pays Stripe's card fee
      feePayerBy: string | null;
    };

type Row = {
  fee_payer: "org" | "team";
  fee_payer_by: string | null;
  checked_at: Date | null;
  account_id: string;
  charges_enabled: boolean;
  details_submitted: boolean;
  connected_by: string;
  connected_at: Date;
};

const owner = async (deps: Deps, viewer: SessionUser, org: string) => isOrgOwner(deps.pool, viewer.coachId, org);

async function rowOf(q: Pick<Pool, "query">, org: string, live: boolean): Promise<Row | null> {
  const r = await q.query<Row>(
    `select account_id, charges_enabled, details_submitted, connected_by, connected_at, checked_at, fee_payer, fee_payer_by
       from org_stripe where org = $1 and livemode = $2`,
    [org, live],
  );
  return r.rows[0] ?? null;
}

const statusOf = (r: Row, live: boolean): PaymentStatus => ({
  state: r.charges_enabled ? "ready" : "pending",
  account: r.account_id,
  connectedBy: r.connected_by,
  connectedAt: r.connected_at,
  live,
  feePayer: r.fee_payer,
  feePayerBy: r.fee_payer_by,
});

// Who pays Stripe's card fee on this organization's registrations: the organization (out of what it receives) or the
// team (added as Card processing). Owners.
export async function setFeePayer(deps: Deps, viewer: SessionUser, org: unknown, payer: unknown) {
  if (!isOrgSlug(org) || !(await owner(deps, viewer, org))) return { ok: false as const, message: "Only the organization's Owners can change this." };
  if (payer !== "org" && payer !== "team") return { ok: false as const, message: "Pick who pays the card fee." };
  if (!deps.stripe) return { ok: false as const, message: "Online payments aren't set up on CourtCaptain yet." };
  const r = await deps.pool.query(
    "update org_stripe set fee_payer = $3, fee_payer_by = $4, fee_payer_at = $5 where org = $1 and livemode = $2",
    [org, deps.stripe.live, payer, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
  );
  return r.rowCount ? { ok: true as const } : { ok: false as const, message: "Connect Stripe first." };
}

// The Payments card (Owners only; null for anyone else). While Stripe still needs details, asks Stripe again (at most
// every 10 minutes: the gear is built on every page; coming back from Stripe asks at once). A Stripe hiccup shows the
// last answer.
export async function paymentStatus(deps: Deps, viewer: SessionUser, org: string): Promise<PaymentStatus | null> {
  if (!isOrgSlug(org) || !(await owner(deps, viewer, org))) return null;
  if (!deps.stripe) return { state: "not-set-up" };
  const r = await rowOf(deps.pool, org, deps.stripe.live);
  if (!r) return { state: "not-connected" };
  const stale = !r.checked_at || deps.now().getTime() - r.checked_at.getTime() > 10 * 60_000;
  if (!r.charges_enabled && stale) {
    try {
      return statusOf((await refresh(deps, org)) ?? r, deps.stripe.live);
    } catch (e) {
      console.error("Stripe account check failed:", e);
    }
  }
  return statusOf(r, deps.stripe.live);
}

// Asks Stripe whether the organization's account can take payments yet, and saves the answer.
export async function refresh(deps: Deps, org: string): Promise<Row | null> {
  if (!deps.stripe) return null;
  const r = await rowOf(deps.pool, org, deps.stripe.live);
  if (!r) return null;
  const ready = await deps.stripe.isReady(r.account_id);
  const u = await deps.pool.query<Row>(
    `update org_stripe set charges_enabled = $3, details_submitted = $4, checked_at = $5 where org = $1 and livemode = $2
     returning account_id, charges_enabled, details_submitted, connected_by, connected_at, checked_at, fee_payer, fee_payer_by`,
    [org, deps.stripe.live, ready, ready, deps.now()],
  );
  return u.rows[0] ?? null;
}

export type ConnectResult = { ok: true; url: string } | { ok: false; message: string };

// Connect Stripe / Finish Stripe setup: makes the organization's Stripe account the first time (once, even on a double
// tap), then a Stripe sign-up link for it. `base`: this site's address, for Stripe's way back.
export async function startConnect(
  deps: Deps,
  viewer: SessionUser,
  org: unknown,
  base: string,
  info: { name: string; email: string | null },
): Promise<ConnectResult> {
  if (!isOrgSlug(org) || !(await owner(deps, viewer, org))) return { ok: false, message: "Only the organization's Owners can connect Stripe." };
  const stripe = deps.stripe;
  if (!stripe) return { ok: false, message: "Online payments aren't set up on CourtCaptain yet." };
  const account = await withTx(deps.pool, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext('org-stripe:' || $1))", [org]);
    const have = await rowOf(q, org, stripe.live);
    if (have) return have.account_id;
    const id = await stripe.createAccount({ name: info.name, email: info.email, org });
    await q.query(
      "insert into org_stripe (org, livemode, account_id, connected_by, connected_at) values ($1, $2, $3, $4, $5)",
      [org, stripe.live, id, `${viewer.firstName} ${viewer.lastName}`, deps.now()],
    );
    return id;
  });
  return { ok: true, url: await linkFor(stripe, account, org, base) };
}

// Stripe's sign-up link expired or was used (Stripe sends them back here): a fresh one for the account it already has.
export async function resumeConnect(deps: Deps, viewer: SessionUser, org: unknown, base: string): Promise<ConnectResult> {
  if (!isOrgSlug(org) || !(await owner(deps, viewer, org))) return { ok: false, message: "Only the organization's Owners can connect Stripe." };
  if (!deps.stripe) return { ok: false, message: "Online payments aren't set up on CourtCaptain yet." };
  const r = await rowOf(deps.pool, org, deps.stripe.live);
  if (!r) return { ok: false, message: "Tap Connect Stripe in the organization's settings." };
  return { ok: true, url: await linkFor(deps.stripe, r.account_id, org, base) };
}

const linkFor = (stripe: StripeApi, account: string, org: string, base: string) =>
  stripe.onboardingLink({
    account,
    refreshUrl: `${base}/stripe/connect?org=${encodeURIComponent(org)}`,
    returnUrl: `${base}/stripe/return?org=${encodeURIComponent(org)}`,
  });
