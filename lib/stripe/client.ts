import "server-only";
import Stripe from "stripe";
import type { StripeApi } from "./connect";

// CourtCaptain's Stripe platform (Connect), from STRIPE_SECRET_KEY in .env.local (and the host's settings). Test keys
// (sk_test_) while building: no real money. Null when it isn't set: Payments says online paying isn't set up.
// Connected accounts use Stripe's Accounts v2 (Stripe no longer lets new platforms make v1 accounts): each organization
// gets the full Stripe dashboard, collects card payments itself, and pays Stripe's fees and handles disputes (like a
// Standard account).
let client: Stripe | null = null;
export function stripeApi(): StripeApi | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const s = (client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 }));
  return {
    live: key.startsWith("sk_live_") || key.startsWith("rk_live_"),
    createAccount: async ({ name, email, org }) =>
      (
        await s.v2.core.accounts.create({
          display_name: name,
          ...(email ? { contact_email: email } : {}),
          dashboard: "full",
          identity: { country: "us" },
          configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
          defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
          metadata: { courtcaptain_org: org },
        })
      ).id,
    isReady: async (account) =>
      (await s.v2.core.accounts.retrieve(account, { include: ["configuration.merchant"] })).configuration?.merchant?.capabilities
        ?.card_payments?.status === "active",
    onboardingLink: async ({ account, refreshUrl, returnUrl }) =>
      (
        await s.v2.core.accountLinks.create({
          account,
          use_case: { type: "account_onboarding", account_onboarding: { refresh_url: refreshUrl, return_url: returnUrl } },
        })
      ).url,
    createCheckout: async ({ account, lines, successUrl, cancelUrl, ref, embedded }) => {
      const c = await s.checkout.sessions.create(
        {
          mode: "payment",
          // In the page (Stripe's form opens right under the summary): back to successUrl when paid, no cancel page.
          ...(embedded ? { ui_mode: "embedded_page" as const, return_url: successUrl } : { success_url: successUrl, cancel_url: cancelUrl }),
          // Cards only, which on Checkout brings Apple Pay and Google Pay (when on in CourtCaptain's Stripe → Settings →
          // Connect → Payment methods); no buy-now-pay-later, bank or other methods. Link rides along with cards (and
          // brings its own bank and Klarna options), so it's turned off here.
          allowed_payment_method_types: ["card"],
          wallet_options: { link: { display: "never" } },
          line_items: lines.map((l) => ({
            quantity: 1,
            price_data: { currency: "usd", unit_amount: l.cents, product_data: { name: l.name.slice(0, 250) } },
          })),
          client_reference_id: ref,
          metadata: { courtcaptain_payment: ref },
          payment_intent_data: { metadata: { courtcaptain_payment: ref } },
        },
        { stripeAccount: account, idempotencyKey: `cc-reg-${ref}${embedded ? "-in-page" : ""}` },
      );
      return { id: c.id, url: c.url ?? "", clientSecret: c.client_secret ?? undefined };
    },
    checkoutPaid: async ({ account, id }) =>
      (await s.checkout.sessions.retrieve(id, {}, { stripeAccount: account })).payment_status === "paid",
    refund: async ({ account, sessionId, cents, key }) => {
      const session = await s.checkout.sessions.retrieve(sessionId, {}, { stripeAccount: account });
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (!pi) throw new Error("That payment has no charge to refund.");
      return (await s.refunds.create({ payment_intent: pi, amount: cents }, { stripeAccount: account, idempotencyKey: key })).id;
    },
  };
}

// A notice from Stripe (app/stripe/webhook), checked as really from Stripe with STRIPE_WEBHOOK_SECRET (from the Stripe
// CLI's `stripe listen` locally, or the webhook endpoint in Stripe's dashboard on a host). Null when it isn't, or no
// secret is set.
export function verifiedEvent(body: string, signature: string | null): Stripe.Event | null {
  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret || !signature) return null;
  const s = (client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 }));
  try {
    return s.webhooks.constructEvent(body, signature, secret);
  } catch {
    return null;
  }
}
