// Stripe's own notices (webhook; SPEC.md section 14, Payments). Stripe tells the app when a Checkout on an
// organization's account is paid, so a team is registered even if its manager closed the page before Stripe sent them
// back. The notice is checked as really from Stripe (its signature, in app/stripe/webhook) before it gets here, and
// confirmPayment asks Stripe again and matches our own record, so nothing in it is trusted on its own.
import type { Pool } from "pg";
import type { StripeApi } from "./connect";
import { confirmPayment } from "./registration";

type Deps = { pool: Pool; stripe: StripeApi | null; now: () => Date };

// Just what's read from a Stripe event.
export type StripeEvent = {
  type: string;
  account?: string | null; // the organization's Stripe account it happened on
  data: { object: { id?: string; object?: string; metadata?: Record<string, string> | null } };
};

const PAID = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

// What the app did with it (for the log; Stripe only needs a 200 back).
// `onPaid`: called when a payment went through on this notice (its invoice is emailed).
export async function handleStripeEvent(
  deps: Deps,
  e: StripeEvent,
  onPaid?: (paid: { programId: string; org: string }) => void,
): Promise<string> {
  if (!PAID.has(e.type)) return "ignored";
  const s = e.data.object;
  const ref = s.metadata?.courtcaptain_payment;
  if (s.object !== "checkout.session" || !s.id || !ref) return "not ours";
  const r = await confirmPayment(deps, ref, s.id);
  if (r.ok && r.paidNow) onPaid?.(r.paidNow);
  return r.ok ? (r.registered ? "registered" : "not paid yet") : `not registered: ${r.message}`;
}
