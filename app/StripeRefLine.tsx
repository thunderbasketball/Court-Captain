import type { StripeRef } from "@/lib/stripe/refunds";

// A card payment's reference in Stripe: the card, Stripe's payment id (tap and hold, or select, to copy) and its page in the
// League's own Stripe dashboard.
export default function StripeRefLine({ r }: { r: StripeRef }) {
  if (!r.payment) return <span className="text-zinc-500">Not found in Stripe yet</span>;
  return (
    <span className="block min-w-0 space-y-0.5">
      {r.card && <span className="block">{r.card}</span>}
      <span className="block text-xs break-all text-zinc-500 select-all">{r.payment}</span>
      {r.url && (
        <a href={r.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-thunder-blue hover:underline dark:text-blue-400">
          View in Stripe ↗
        </a>
      )}
    </span>
  );
}
