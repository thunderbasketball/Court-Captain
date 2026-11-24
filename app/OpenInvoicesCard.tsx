import Link from "next/link";
import type { Invoice } from "@/lib/invoices";
import { InvoiceActions } from "./invoice/[org]/[programId]/InvoiceActions";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// An organization's Home (whoever manages its teams): each League invoice with a balance due (Pay later, or teams not yet
// paid), with View invoice and Pay by card (when the League takes cards).
// `today`: a Pay later invoice shows its due date, red once it's past.
export default function OpenInvoicesCard({ invoices, canPay, today }: { invoices: Invoice[]; canPay: boolean; today: string }) {
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
            <div className="shrink-0 text-right">
              <p className="font-bold tabular-nums">{money(inv.dueCents)} due</p>
              {inv.dueOn && (
                <p className={`text-xs ${inv.dueOn < today ? "font-semibold text-red-600 dark:text-red-400" : "text-zinc-500"}`}>
                  {inv.dueOn < today ? "Overdue since" : "by"} {day(inv.dueOn)}
                </p>
              )}
            </div>
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
