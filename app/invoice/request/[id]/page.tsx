import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import AppHeader from "../../../AppHeader";
import PaidNotice from "../../../PaidNotice";
import PageOutline from "../../../PageOutline";
import RequestedActions from "../../../cart/RequestedActions";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requestedInvoice } from "@/lib/cart-invoices";
import { db } from "@/lib/db";
import { stripeApi } from "@/lib/stripe/client";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const TONE = { PENDING: "bg-amber-100 text-amber-900", PAID: "bg-emerald-100 text-emerald-800", CLOSED: "bg-zinc-200 text-zinc-700" };

// An invoice requested from a cart (SPEC.md section 14): its teams, what each picked and costs, and pay by when; Print, Pay
// by card, Cancel, and Mark paid (the League's Owners). Nothing on it is registered until it's paid. Seen by whoever
// requested it, whoever manages the organization's teams, and the League's Owners.
type Params = { params: Promise<{ id: string }> };

export default function RequestedInvoicePage({ params }: Params) {
  return (
    <Suspense fallback={<PageOutline />}>
      <Invoice params={params} />
    </Suspense>
  );
}

async function Invoice({ params }: Params) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { id } = await params;
  const inv = await requestedInvoice({ pool: db, stripe: stripeApi(), now: () => new Date() }, user, id);
  if (!inv) notFound();
  const act = !user.actingBy;
  return (
    <>
      <div className="print:hidden">
        <AppHeader user={user} context={inv.org === "thunder" ? "director" : inv.org === "scenic-city" ? "scenic:Coach" : `org:${inv.org}`} />
      </div>
      <Suspense fallback={null}>
        <PaidNotice />
      </Suspense>
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-6 print:max-w-none print:p-0">
        <RequestedActions
          id={inv.id}
          amount={money(inv.cents + inv.cardCents)}
          canPay={act && inv.canPay}
          canMarkPaid={act && inv.canMarkPaid}
          canCancel={act && inv.canCancel}
          print
        />
        <article className="space-y-5 rounded-2xl bg-white p-6 ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10 print:rounded-none print:bg-white print:text-black print:ring-0">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Invoice #{inv.id}</p>
              <h1 className="text-xl font-semibold">{inv.from}</h1>
              <p className="text-sm text-zinc-500">
                Requested by {inv.requestedBy} ·{" "}
                {inv.requestedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })}
              </p>
              {inv.state === "PENDING" && <p className="text-sm font-semibold">Pay by {day(inv.due)}</p>}
            </div>
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${TONE[inv.state]}`}>{inv.state}</span>
          </header>
          <div className="text-sm">
            <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">Bill to</p>
            <p className="font-semibold">{inv.orgName}</p>
            <p className="text-zinc-500">{inv.program}</p>
          </div>
          {inv.state === "PENDING" ? (
            <>
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 text-xs text-zinc-500 uppercase dark:border-white/10">
                  <tr>
                    <th className="py-2 font-semibold">Team</th>
                    <th className="py-2 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                  {inv.lines.map((l) => (
                    <tr key={`${l.team} ${l.what}`} className="align-top">
                      <td className="py-2">
                        <p className="font-medium">
                          {l.team} <span className="text-xs font-normal text-zinc-500">{l.level}</span>
                        </p>
                        <p className="text-xs text-zinc-500">
                          {l.adding && "Adding: "}
                          {l.what}
                        </p>
                        {l.problem && <p className="text-xs font-medium text-red-600">{l.problem}</p>}
                      </td>
                      <td className="py-2 text-right tabular-nums">{l.problem ? "—" : money(l.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="ml-auto flex w-full max-w-xs justify-between border-t border-zinc-200 pt-3 text-base font-bold dark:border-white/10">
                <span>Total due</span>
                <span className="tabular-nums">{money(inv.cents)}</span>
              </p>
              {inv.cardCents > 0 && (
                <p className="text-right text-xs text-zinc-500">
                  {money(inv.cents + inv.cardCents)} paid by card (with {money(inv.cardCents)} card processing)
                </p>
              )}
              <p className="text-xs text-zinc-500">The teams register when it&apos;s paid. Not paid by the date above, it&apos;s closed and nothing is registered.</p>
            </>
          ) : (
            <p className="text-sm">{inv.state === "PAID" ? `Paid (${inv.paidBy}): its teams are registered.` : "This invoice is closed: it was cancelled, or not paid in time."}</p>
          )}
        </article>
      </main>
    </>
  );
}
