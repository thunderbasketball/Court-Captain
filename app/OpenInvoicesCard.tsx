import Link from "next/link";
import type { Invoice } from "@/lib/invoices";
import { InvoiceActions } from "./invoice/[org]/[programId]/InvoiceActions";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

// An organization's Home (whoever manages its teams): each League invoice with a balance due (Pay later, or teams not yet
// paid), with View invoice and Pay by card (when the League takes cards).
export default function OpenInvoicesCard({ invoices, canPay }: { invoices: Invoice[]; canPay: boolean }) {
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-white/5">
      {invoices.map((inv) => (
        <li key={inv.programId} className="space-y-2 py-3">
          <div className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-semibold">
                {inv.from}: {inv.program}
              </p>
              <p className="text-xs text-zinc-500">
                {inv.lines.filter((l) => !l.paid).length} of {inv.lines.length} teams unpaid{inv.payLater ? " · Pay later" : ""}
              </p>
            </div>
            <p className="shrink-0 text-right font-bold tabular-nums">{money(inv.dueCents)} due</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/invoice/${encodeURIComponent(inv.org)}/${inv.programId}`}
              className="text-sm font-medium text-thunder-blue dark:text-blue-400"
            >
              View invoice
            </Link>
            <InvoiceActions org={inv.org} programId={inv.programId} canPay={canPay} due={money(inv.dueCents)} payOnly />
          </div>
        </li>
      ))}
    </ul>
  );
}
