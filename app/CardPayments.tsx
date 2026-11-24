import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { stripeApi } from "@/lib/stripe/client";
import { cardPayments, type PaymentTeam } from "@/lib/stripe/refunds";
import { TZ } from "@/lib/time";
import RefundForm from "./RefundForm";
import StripeRefLine from "./StripeRefLine";
import SubCard from "./SubCard";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const when = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
const STATE: Record<PaymentTeam["state"], string> = {
  registered: "text-emerald-700 dark:text-emerald-400",
  withdrawn: "text-amber-700 dark:text-amber-300",
  deleted: "text-red-600 dark:text-red-400",
  waiting: "text-red-600 dark:text-red-400",
};
const SAY: Record<PaymentTeam["state"], string> = { registered: "Registered", withdrawn: "Withdrawn", deleted: "Deleted", waiting: "Not registered" };

// Inside a League's Registrations (its Owners): card payments with no team still registered (the rest show on the
// team's own card), newest first, with its teams (still registered,
// withdrawn or deleted), what was paid and refunded, and Refund (any amount up to what's left). Paid but not registered:
// flagged red with why. The card flashes while one of those waits for a refund.
export default async function CardPayments({ user, programId }: { user: SessionUser; programId: string }) {
  const stripe = stripeApi();
  // Payments with a team still registered show on that team's card (Registrations), with Refund; here, the rest.
  const list = (await cardPayments(db, user, programId, stripe?.live ?? false))?.filter(
    (p) => p.status !== "registered" || !p.teams.some((t) => t.state === "registered"),
  );
  if (!list || !list.length) return null;
  const owed = list.filter((p) => p.status === "failed" && p.refundedCents < p.paidCents).length;
  return (
    <SubCard title="Refunded Registrations" count={list.length} alert={owed > 0}>
      <ul className="divide-y divide-zinc-100 text-sm dark:divide-white/5">
        {list.map((p) => {
          const left = p.paidCents - p.refundedCents;
          return (
            <li key={p.id} className="space-y-1 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {p.teams.map((t) => (
                    <p key={t.name} className="truncate">
                      <span className="font-semibold">{t.name}</span> <span className={`text-xs font-medium ${STATE[t.state]}`}>· {SAY[t.state]}</span>
                    </p>
                  ))}
                  <p className="text-xs text-zinc-500">
                    {p.org ? `${p.org} · ` : ""}paid by {p.startedBy} on {when(p.at)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-semibold tabular-nums">{money(p.paidCents)}</p>
                  {p.refundedCents > 0 && (
                    <p className="text-xs font-medium text-amber-700 tabular-nums dark:text-amber-300">−{money(p.refundedCents)} refunded</p>
                  )}
                </div>
              </div>
              <StripeRefLine r={p.stripe} />
              {p.status === "failed" && <p className="text-xs font-semibold text-red-600 dark:text-red-400">Paid, but not registered: {p.error}</p>}
              {p.refunds.map((f, i) => (
                <p key={i} className="text-xs text-zinc-500">
                  Refunded {money(f.cents)} by {f.by} on {when(f.at)}
                </p>
              ))}
              {left > 0 && stripe && <RefundForm paymentId={p.id} left={left} who={p.org ?? p.startedBy} />}
            </li>
          );
        })}
      </ul>
    </SubCard>
  );
}
