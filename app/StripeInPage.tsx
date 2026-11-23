"use client";

// Stripe's card form opened right in the page (Stripe's embedded Checkout: card, Apple Pay, Google Pay), under what's
// being paid for, with Cancel. Paying takes the person to /stripe/paid, which adds or registers once Stripe says it's
// paid (as with Stripe's own page). Cancel only closes the form: nothing is added. Needs Stripe's publishable key
// (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, not a secret); without it, payments go to Stripe's own page as before.
import { useMemo } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";

const KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
// Whether this site can open Stripe's form in the page (asked for by the buttons; checked again on the server).
export const payInPage = !!KEY;

// One Stripe.js per League Stripe account (payments go to the League's own account).
const loaded = new Map<string, Promise<Stripe | null>>();
const stripeFor = (account: string) => {
  if (!loaded.has(account)) loaded.set(account, loadStripe(KEY, { stripeAccount: account }));
  return loaded.get(account)!;
};

export default function StripeInPage({
  pay,
  onCancel,
  amount,
}: {
  pay: { clientSecret: string; account: string };
  onCancel: () => void;
  amount?: string; // "$35", shown above the form
}) {
  const stripe = useMemo(() => stripeFor(pay.account), [pay.account]);
  return (
    <div className="space-y-2 rounded-xl p-2 ring-1 ring-[#635bff]/40">
      <div className="flex items-center justify-between px-1">
        <p className="text-sm font-semibold">Pay {amount ?? ""} by card</p>
        <button type="button" onClick={onCancel} className="rounded-full px-3 py-1 text-sm font-medium text-zinc-600 ring-1 ring-zinc-950/15 dark:text-zinc-300 dark:ring-white/20">
          Cancel
        </button>
      </div>
      <div className="overflow-hidden rounded-lg bg-white">
        <EmbeddedCheckoutProvider key={pay.clientSecret} stripe={stripe} options={{ clientSecret: pay.clientSecret }}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
      <p className="px-1 text-xs text-zinc-500">Nothing is added until the payment goes through. Cancel closes this without paying.</p>
    </div>
  );
}
