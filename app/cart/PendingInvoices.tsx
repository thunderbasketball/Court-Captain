import Link from "next/link";
import type { RequestedInvoice } from "@/lib/cart-invoices";
import RequestedActions from "./RequestedActions";

const money = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Invoices requested from a cart, not paid yet (PENDING): whose, how much, pay by when, and their buttons. `league`: on the
// League's program (which organization).
export default function PendingInvoices({ list, league = false, canAct }: { list: RequestedInvoice[]; league?: boolean; canAct: boolean }) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-white/5">
      {list.map((i) => (
        <li key={i.id} className="space-y-2 py-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">
                #{i.id} · {league ? i.orgName : `${i.from}: ${i.program}`}
              </p>
              <p className="text-xs text-zinc-500">
                {i.lines.length} team{i.lines.length === 1 ? "" : "s"} · requested by {i.requestedBy} · not registered until it&apos;s paid
              </p>
              <Link href={`/invoice/request/${i.id}`} className="text-xs font-medium text-thunder-blue dark:text-blue-400">
                View invoice
              </Link>
            </div>
            <div className="shrink-0 text-right">
              <p className="font-bold tabular-nums">{money(i.cents)}</p>
              <p className="text-xs text-zinc-500">pay by {day(i.due)}</p>
            </div>
          </div>
          <RequestedActions
            id={i.id}
            amount={money(i.cents + i.cardCents)}
            canPay={canAct && i.canPay && !league}
            canMarkPaid={canAct && i.canMarkPaid && league}
            canCancel={canAct && i.canCancel}
          />
        </li>
      ))}
    </ul>
  );
}
