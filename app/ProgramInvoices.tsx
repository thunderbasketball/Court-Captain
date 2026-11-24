import Link from "next/link";
import { INVOICE_STATUSES, invoiceStatus, type Invoice, type InvoiceStatus } from "@/lib/invoices";
import type { RequestedInvoice } from "@/lib/cart-invoices";
import PendingInvoices from "./cart/PendingInvoices";
import SubCard from "./SubCard";

const money = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const ABOUT: Record<InvoiceStatus, string> = {
  "PAST DUE": "Their due date has passed.",
  DUE: "A balance is owed. Pay later is due 30 days after registering (registered from a cart: the day before the event); the rest is due now.",
  PENDING: "Requested, not paid yet: their teams register once it's paid.",
  PAID: "Nothing owed.",
};
const TONE: Record<InvoiceStatus, string> = {
  "PAST DUE": "text-red-600 dark:text-red-400",
  DUE: "text-amber-700 dark:text-amber-400",
  PENDING: "text-zinc-600 dark:text-zinc-300",
  PAID: "text-emerald-700 dark:text-emerald-400",
};

// A League program's Invoices card (the League's Owners): a card for each of PAST DUE, DUE, PENDING and PAID with how many
// and how much, opening to the organizations' invoices. Teams from no organization have none (they're in Registrations).
export default function ProgramInvoices({
  invoices,
  pending,
  others,
  today,
  canAct,
}: {
  invoices: Invoice[];
  pending: RequestedInvoice[]; // requested from a cart, not paid yet
  others: { teams: number; unpaid: number };
  today: string;
  canAct: boolean;
}) {
  return (
    <div className="space-y-2">
      {INVOICE_STATUSES.map((s) => {
        if (s === "PENDING")
          return (
            <SubCard key={s} title={s} count={pending.length ? `${pending.length} · ${money(pending.reduce((n, i) => n + i.cents, 0))}` : 0} warn={pending.length > 0}>
              <p className="mb-2 text-xs text-zinc-500">{ABOUT[s]}</p>
              {pending.length ? <PendingInvoices list={pending} league canAct={canAct} /> : <p className="text-sm text-zinc-500">None.</p>}
            </SubCard>
          );
        const list = invoices.filter((i) => invoiceStatus(i, today) === s);
        const cents = list.reduce((n, i) => n + (s === "PAID" ? i.paidCents : i.dueCents), 0);
        return (
          <SubCard key={s} title={s} count={list.length ? `${list.length} · ${money(cents)}` : 0} alert={s === "PAST DUE" && list.length > 0} open={s === "PAST DUE" && list.length > 0}>
            <p className="mb-2 text-xs text-zinc-500">{ABOUT[s]}</p>
            {!list.length && <p className="text-sm text-zinc-500">None.</p>}
            <ul className="divide-y divide-zinc-100 dark:divide-white/5">
              {[...list]
                .sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? "") || a.orgName.localeCompare(b.orgName))
                .map((i) => (
                  <li key={i.org} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{i.orgName}</p>
                      <p className="text-xs text-zinc-500">
                        {i.lines.length} team{i.lines.length === 1 ? "" : "s"} · {money(i.totalCents)} total · {money(i.paidCents)} paid
                        {i.payLater && " · Pay later"}
                      </p>
                      <Link href={`/invoice/${encodeURIComponent(i.org)}/${i.programId}`} className="text-xs font-medium text-thunder-blue dark:text-blue-400">
                        View invoice
                      </Link>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`font-bold tabular-nums ${TONE[s]}`}>{money(s === "PAID" ? i.paidCents : i.dueCents)}</p>
                      <p className="text-xs text-zinc-500">
                        {s === "PAID" ? "paid" : i.dueOn ? `${s === "PAST DUE" ? "was due" : "due"} ${day(i.dueOn)}` : "due now"}
                      </p>
                    </div>
                  </li>
                ))}
            </ul>
          </SubCard>
        );
      })}
      {others.teams > 0 && (
        <p className="px-1 text-xs text-zinc-500">
          {others.teams} team{others.teams === 1 ? "" : "s"} from no organization here (clubs, Solo, FastBreak) get no invoice{others.unpaid > 0 && `; ${others.unpaid} unpaid`}: see
          Registrations.
        </p>
      )}
    </div>
  );
}
